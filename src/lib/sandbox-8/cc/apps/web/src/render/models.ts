/**
 * Low-poly construction machine models. Each model faces +x (heading 0 = east), stands on y = 0,
 * and is built from boxes/cylinders merged into a few vertex-coloured geometries: one static body
 * plus articulated parts (excavator house/boom/stick/bucket, loader arms, roller drums, truck load).
 * Geometries are cached per (class, model, colour); one shared material serves all machines.
 */
import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, Group, LatheGeometry, Mesh, type Material, Quaternion, Shape, SphereGeometry, CapsuleGeometry, TorusGeometry, Vector2, Vector3 } from 'three';
import { engineMounts } from './assemblies.ts';
import { assetSize, equipmentAsset, itemGeometry, itemParts } from './item-assets.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FIN, PATTERN, type Finish, type FinishName } from './finish.ts';

const DARK = '#2b2c2e';
const STEEL = '#55585c';
const GLASS = '#26343f';
const TYRE = '#1d1d1f';
const RUBBER = '#232325';
const LIGHT = '#d8d8d2';
const WOOD = '#9c7a4f';

type V3 = [number, number, number];

/** a shape from points (x along, y up) */
export function poly(pts: [number, number][]): Shape {
  const sh = new Shape();
  sh.moveTo(pts[0]![0], pts[0]![1]);
  for (const [x, y] of pts.slice(1)) sh.lineTo(x, y);
  sh.closePath();
  return sh;
}

/** a rectangle with rounded corners, its lower left at (x, y) */
export function rrect(x: number, y: number, w: number, h: number, r: number): Shape {
  const sh = new Shape();
  sh.moveTo(x + r, y);
  sh.lineTo(x + w - r, y);
  sh.quadraticCurveTo(x + w, y, x + w, y + r);
  sh.lineTo(x + w, y + h - r);
  sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  sh.lineTo(x + r, y + h);
  sh.quadraticCurveTo(x, y + h, x, y + h - r);
  sh.lineTo(x, y + r);
  sh.quadraticCurveTo(x, y, x + r, y);
  return sh;
}

/** a colour with its finish (a steel blade, a nylon fly, a tiled roof) */
export type Paint = string | Color | 'B' | number;
export const F = (c: string, f: FinishName | Finish): Color => Object.assign(new Color(c), { fin: typeof f === 'string' ? FIN[f] : f });

/** the finish of the shared part colours, unless one is given */
const FIN_OF: Record<string, Finish> = { [DARK]: FIN.dull, [STEEL]: FIN.metal, [GLASS]: FIN.glass, [TYRE]: FIN.rubber, [RUBBER]: FIN.rubber, [LIGHT]: FIN.lens, [WOOD]: FIN.wood };

export class Kit {
  parts: BufferGeometry[] = [];
  private assemblies = new Map<string, BufferGeometry[]>();
  constructor(private body: Color, private bodyFin: Finish = FIN.paint, private separateParts = false) {}

  /** Stable assembly boundaries around a recipe's major physical parts. */
  part(id: string, build: () => void): this {
    const start = this.parts.length;
    build();
    this.assemble(start, id);
    return this;
  }

  private assemble(start: number, id: string): void {
    if (!this.separateParts) return;
    const geoms = this.parts.splice(start);
    this.assemblies.set(id, [...(this.assemblies.get(id) ?? []), ...geoms]);
  }

  /** Thin compartment walls and a separate top cover leave actual space for a power unit. */
  engineBay(w: number, h: number, d: number, x: number, y: number, z: number, color: string | number, cover = 'engineCover'): this {
    const t = .045;
    this.box(w, t, d, x, y - h / 2 + t / 2, z, color);
    for (const side of [-1, 1]) {
      this.box(w, h - t, t, x, y, z + side * (d - t) / 2, color);
      this.box(t, h - t, d - 2 * t, x + side * (w - t) / 2, y, z, color);
    }
    const start = this.parts.length;
    this.box(w, t, d, x, y + h / 2, z, color);
    this.assemble(start, cover);
    return this;
  }

  private paint(g: BufferGeometry, color: Paint): BufferGeometry {
    const c = color === 'B' ? this.body : typeof color === 'number' ? this.body.clone().multiplyScalar(color) : color instanceof Color ? color : new Color(color);
    const f: Finish = (color instanceof Color ? (color as Color & { fin?: Finish }).fin : undefined) ?? (typeof color === 'string' && color !== 'B' ? FIN_OF[color] : undefined) ?? (color === 'B' || typeof color === 'number' ? this.bodyFin : FIN.paint);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    const fa = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
      fa[i * 3] = f[0];
      fa[i * 3 + 1] = f[1];
      fa[i * 3 + 2] = f[2];
    }
    g.setAttribute('color', new Float32BufferAttribute(arr, 3));
    g.setAttribute('fin', new Float32BufferAttribute(fa, 3));
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (g.getAttribute('uv1')) g.deleteAttribute('uv1');
    if (g.index) {
      const ng = g.toNonIndexed();
      g.dispose();
      return ng;
    }
    return g;
  }

  /** add an arbitrary geometry (consumed) painted in a colour */
  add(g: BufferGeometry, color: Paint): this {
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    this.parts.push(this.paint(g, color));
    return this;
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: Paint, rz = 0, ry = 0): this {
    const g = new BoxGeometry(w, h, d);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this.parts.push(this.paint(g, color));
    return this;
  }

  /** cylinder with its axis along z (wheels, drums) or y */
  cyl(r: number, len: number, x: number, y: number, z: number, color: Paint, axis: 'z' | 'y' | 'x' = 'z', seg = 12): this {
    const g = new CylinderGeometry(r, r, len, seg);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    else if (axis === 'x') g.rotateZ(Math.PI / 2);
    g.translate(x, y, z);
    this.parts.push(this.paint(g, color));
    return this;
  }

  wheel(r: number, w: number, x: number, y: number, z: number): this {
    const start = this.parts.length;
    this.cyl(r, w, x, y, z, TYRE, 'z', 14);
    this.cyl(r * 0.55, w * 1.02, x, y, z, STEEL, 'z', 10);
    this.assemble(start, `wheel:${x}:${z}`);
    return this;
  }

  sphere(r: number, x: number, y: number, z: number, color: Paint): this {
    const g = new SphereGeometry(r, 10, 6).translate(x, y, z);
    this.parts.push(this.paint(g, color));
    return this;
  }

  capsule(r: number, len: number, x: number, y: number, z: number, color: Paint): this {
    const g = new CapsuleGeometry(r, len, 4, 8).translate(x, y, z);
    this.parts.push(this.paint(g, color));
    return this;
  }

  /** cab with glazing: body-coloured frame with dark glass bands */
  cab(w: number, h: number, d: number, x: number, y: number, z: number, color: Paint = 'B'): this {
    const start = this.parts.length;
    this.box(w, h, d, x, y, z, color);
    this.box(w + 0.04, h * 0.5, d * 0.86, x, y + h * 0.12, z, GLASS);
    this.box(w * 0.86, h * 0.5, d + 0.04, x, y + h * 0.12, z, GLASS);
    this.box(w + 0.06, 0.08, d + 0.06, x, y + h / 2, z, color);
    this.assemble(start, 'cab');
    return this;
  }

  tracks(len: number, h: number, w: number, gauge: number): this {
    for (const s of [-1, 1]) {
      const start = this.parts.length;
      this.box(len, h, w, 0, h / 2, (s * gauge) / 2, RUBBER);
      this.cyl(h / 2, w * 1.01, len / 2 - h / 2, h / 2, (s * gauge) / 2, RUBBER, 'z', 10);
      this.cyl(h / 2, w * 1.01, -len / 2 + h / 2, h / 2, (s * gauge) / 2, RUBBER, 'z', 10);
      this.box(len * 0.7, h * 0.35, w * 1.04, 0, h * 0.55, (s * gauge) / 2, STEEL);
      this.assemble(start, s < 0 ? 'leftTrack' : 'rightTrack');
    }
    return this;
  }

  /** a round bar from a to b (tubes, poles, handles, frames) */
  tube(a: V3, b: V3, r: number, color: Paint, seg = 8, r2 = r): this {
    const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length();
    if (len < 1e-6) return this;
    const g = new CylinderGeometry(r2, r, len, seg);
    g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize()));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.parts.push(this.paint(g, color));
    return this;
  }

  /** a polyline of round bar */
  bar(pts: V3[], r: number, color: Paint, seg = 6): this {
    for (let i = 0; i + 1 < pts.length; i += 1) this.tube(pts[i]!, pts[i + 1]!, r, color, seg);
    return this;
  }

  /** a ring (tyre, hoop, bow) of radius R and bar r, about the given axis; `arc` < 2π for a part of one */
  ring(R: number, r: number, x: number, y: number, z: number, color: Paint, axis: 'z' | 'y' | 'x' = 'z', arc = Math.PI * 2, seg = 24, start = 0): this {
    const g = new TorusGeometry(R, r, 6, seg, arc);
    if (start) g.rotateZ(start);
    if (axis === 'y') g.rotateX(Math.PI / 2);
    else if (axis === 'x') g.rotateY(Math.PI / 2);
    g.translate(x, y, z);
    this.parts.push(this.paint(g, color));
    return this;
  }

  /** a turned body: [radius, height] from the bottom up, about a vertical axis */
  lathe(pts: [number, number][], x: number, y: number, z: number, color: Paint, seg = 14): this {
    const g = new LatheGeometry(pts.map(([r, h]) => new Vector2(r, h)), seg);
    g.translate(x, y, z);
    this.parts.push(this.paint(g, color));
    return this;
  }

  /** a side profile in x (along) and y (up), extruded `depth` across z about `z` (a car's body, a caravan's shell) */
  extrude(shape: Shape, depth: number, z: number, color: Paint, bevel = 0, curve = 6): this {
    const g = new ExtrudeGeometry(shape, { depth: depth - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: curve });
    g.translate(0, 0, z - depth / 2 + bevel);
    this.parts.push(this.paint(g, color));
    return this;
  }

  build(): BufferGeometry {
    const g = this.parts.length ? mergeGeometries(this.parts)! : new BufferGeometry().setAttribute('position', new Float32BufferAttribute([], 3));
    if (!this.parts.length) for (const name of ['normal', 'color', 'fin']) g.setAttribute(name, new Float32BufferAttribute([], 3));
    const components = [];
    for (const [id, pieces] of this.assemblies) {
      const geometry = mergeGeometries(pieces)!;
      for (const piece of pieces) piece.dispose();
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const origin = [(box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2];
      if (id.startsWith('wheel:')) origin[1] = (box.min.y + box.max.y) / 2;
      if (id === 'cab') origin[0] = box.max.x;
      if (id === 'bonnet' || id === 'engineCover') origin[0] = box.min.x;
      geometry.translate(-origin[0]!, -origin[1]!, -origin[2]!);
      components.push({ id, geometry, origin });
    }
    g.userData.components = components;
    this.assemblies.clear();
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    return g;
  }
}

/** pivots that animate */
export interface MachineRig {
  root: Group;
  /** everything that moves with the machine body (tilted to the terrain) */
  body: Group;
  meshes: Mesh[];
  house?: Group;
  boom?: Group;
  stick?: Group;
  bucket?: Group;
  arms?: Group;
  drums?: Group[];
  load?: Mesh;
  blade?: Group;
  /** visual length (m) for spacing / selection rings */
  size: number;
  cls: string;
  /** Stable attachment points survive removal/replacement of their installed mesh. */
  mounts: Map<string, Group>;
  components: Map<string, Mesh>;
}

export const knownMachineClasses = new Set(['excavator', 'miniExcavator', 'wheeledExcavator', 'wheelLoader', 'dozer', 'grader', 'soilRoller', 'tandemRoller', 'paver', 'tipper', 'supplier', 'lowLoader', 'waterTruck', 'surveyKit', 'van', 'flatbed', 'mixer', 'foot', 'knife', 'axe', 'saw', 'bicycle', 'caravan', 'siteTrailer', 'plateCompactor', 'powerStation', 'solarPanel', 'generator', 'lightTower', 'car']);

type PartSet = Record<string, BufferGeometry>;

/** a tool drawn in its side view, laid flat on the ground */
function lay(kit: Kit): BufferGeometry {
  const g = kit.build();
  g.rotateX(-Math.PI / 2);
  g.computeBoundingBox();
  const parts = g.userData.components as { geometry: BufferGeometry; origin: number[] }[];
  const low = Math.min(g.boundingBox!.min.y, ...parts.map(p => {
    p.geometry.translate(p.origin[0]!, p.origin[1]!, p.origin[2]!).rotateX(-Math.PI / 2);
    p.geometry.computeBoundingBox();
    return p.geometry.boundingBox!.min.y;
  }));
  g.translate(0, -low, 0);
  for (const p of parts) { p.geometry.translate(0, -low, 0); p.origin = [0, 0, 0]; }
  g.computeBoundingSphere();
  return g;
}

/** an open tray (a barrow's, a crate's): top L × W, bottom l × w, h deep, its walls t thick, standing on y = 0 */
export function tray(L: number, W: number, l: number, w: number, h: number, t: number): BufferGeometry {
  const pos: number[] = [];
  const quad = (a: V3, b: V3, c: V3, d: V3) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const rim = (bl: number, bw: number, y: number): V3[] => [[-bl / 2, y, -bw / 2], [bl / 2, y, -bw / 2], [bl / 2, y, bw / 2], [-bl / 2, y, bw / 2]];
  const ob = rim(l, w, 0);
  const ot = rim(L, W, h);
  const ib = rim(l - 2 * t, w - 2 * t, t);
  const it = rim(L - 2 * t, W - 2 * t, h);
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    quad(ob[i]!, ot[i]!, ot[j]!, ob[j]!);
    quad(ib[j]!, it[j]!, it[i]!, ib[i]!);
    quad(ot[i]!, it[i]!, it[j]!, ot[j]!);
  }
  quad(ob[0]!, ob[1]!, ob[2]!, ob[3]!);
  quad(ib[3]!, ib[2]!, ib[1]!, ib[0]!);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
const cache = new Map<string, PartSet>();

function parts(cls: string, color: string, model: string): PartSet {
  const key = `${cls}|${model}|${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const asset = equipmentAsset(model, cls);
  if (asset) return { base: itemGeometry(asset) };
  const body = new Color(color);
  const k = () => new Kit(body, FIN.paint, true);
  const out: PartSet = {};
  switch (cls) {
    case 'excavator':
    case 'miniExcavator':
    case 'wheeledExcavator': {
      const base = k();
      if (cls === 'wheeledExcavator') {
        base.box(4.2, 0.7, 2.2, 0, 1.0, 0, DARK).box(1.0, 0.3, 2.5, 1.9, 0.5, 0, 'B');
        for (const x of [-1.4, 1.4]) for (const z of [-0.95, 0.95]) base.wheel(0.55, 0.5, x, 0.55, z);
      } else {
        base.tracks(4.5, 0.9, 0.65, 2.5).box(3.0, 0.5, 1.6, 0, 0.75, 0, DARK);
      }
      base.cyl(0.9, 0.3, 0, 1.15, 0, DARK, 'y', 14);
      out.base = base.build();
      const house = k();
      house
        .engineBay(3.0, 1.05, 2.5, -0.45, 0.62, 0, 'B')
        .box(0.85, 1.0, 2.5, -2.2, 0.62, 0, 0.82)
        .box(1.8, 0.35, 1.5, -1.0, 1.32, -0.35, 0.9)
        .box(0.4, 0.5, 0.25, -1.4, 1.6, -0.6, DARK)
        .cab(1.0, 1.6, 0.95, 0.7, 1.35, 0.72);
      out.house = house.build();
      out.boom = k().box(5.6, 0.55, 0.45, 2.8, 0, 0, 'B').box(0.7, 0.18, 0.2, 1.4, 0.4, 0, STEEL, -0.2).build();
      out.stick = k().box(3.0, 0.38, 0.36, 1.5, 0, 0, 'B').box(1.2, 0.14, 0.16, 0.6, 0.27, 0, STEEL).build();
      out.bucket = k().box(0.9, 0.75, 1.1, 0.35, -0.3, 0, DARK).box(0.15, 0.08, 1.1, 0.85, -0.65, 0, STEEL).build();
      break;
    }
    case 'wheelLoader': {
      const b = k();
      b.box(2.8, 1.1, 2.1, -1.5, 1.3, 0, 'B')
        .engineBay(1.4, 0.9, 1.9, -2.5, 2.15, 0, 0.92)
        .box(0.12, 0.6, 0.12, -2.9, 2.85, 0.6, DARK)
        .cab(1.3, 1.6, 1.4, -0.65, 2.65, 0)
        .box(1.8, 0.7, 1.2, 0.9, 1.1, 0, DARK)
        .box(0.4, 0.5, 2.2, -3.0, 1.0, 0, DARK);
      for (const x of [-1.8, 1.0]) for (const z of [-1.0, 1.0]) b.wheel(0.82, 0.62, x, 0.82, z);
      out.base = b.build();
      out.arms = k()
        .box(2.8, 0.32, 0.25, 1.3, 0, 0.65, 'B')
        .box(2.8, 0.32, 0.25, 1.3, 0, -0.65, 'B')
        .box(1.15, 1.0, 2.6, 2.9, -0.15, 0, DARK)
        .box(0.12, 0.1, 2.6, 3.45, -0.62, 0, STEEL)
        .build();
      break;
    }
    case 'dozer': {
      const b = k();
      b.tracks(3.7, 0.85, 0.6, 2.2)
        .box(2.7, 1.2, 1.7, -0.4, 1.35, 0, 'B')
        .engineBay(1.6, 0.9, 1.5, 0.9, 1.65, 0, 'B')
        .box(0.1, 0.6, 0.1, 1.2, 2.3, 0.4, DARK)
        .cab(1.3, 1.45, 1.4, -0.85, 2.65, 0)
        .box(2.2, 0.18, 0.18, 1.4, 0.75, 1.15, DARK)
        .box(2.2, 0.18, 0.18, 1.4, 0.75, -1.15, DARK)
        .box(0.8, 0.2, 0.2, -2.1, 0.9, 0, DARK)
        .box(0.15, 0.9, 0.15, -2.45, 0.55, 0, STEEL);
      out.base = b.build();
      out.blade = k().box(0.35, 1.35, 3.5, 0, 0, 0, 0.88).box(0.08, 0.15, 3.5, 0.2, -0.62, 0, STEEL).build();
      break;
    }
    case 'grader': {
      const b = k();
      b.box(5.6, 0.45, 0.55, 1.9, 1.45, 0, 'B')
        .box(0.6, 0.4, 1.6, 4.5, 1.15, 0, 'B')
        .engineBay(2.6, 1.2, 1.9, -2.3, 1.55, 0, 'B')
        .box(0.12, 0.7, 0.12, -3.2, 2.4, 0.5, DARK)
        .cab(1.5, 1.7, 1.7, -0.45, 2.75, 0)
        .box(0.1, 0.9, 1.6, 1.6, 0.9, 0, DARK);
      b.wheel(0.65, 0.45, 4.5, 0.65, 1.05).wheel(0.65, 0.45, 4.5, 0.65, -1.05);
      for (const x of [-1.6, -3.0]) for (const z of [-1.1, 1.1]) b.wheel(0.65, 0.48, x, 0.65, z);
      out.base = b.build();
      out.blade = k().box(0.3, 0.65, 3.7, 0, 0, 0, STEEL).box(0.06, 0.12, 3.7, 0.15, -0.3, 0, LIGHT).build();
      break;
    }
    case 'soilRoller': {
      const b = k();
      b.engineBay(2.4, 1.2, 2.0, -0.9, 1.35, 0, 'B')
        .box(0.9, 0.55, 2.5, 1.6, 1.75, 0, 'B')
        .box(0.3, 1.2, 0.2, 1.6, 1.1, 1.2, 'B')
        .box(0.3, 1.2, 0.2, 1.6, 1.1, -1.2, 'B')
        .box(0.8, 0.5, 0.8, 0.5, 1.4, 0, DARK)
        .cab(1.1, 1.45, 1.35, -0.4, 2.7, 0);
      b.wheel(0.78, 0.6, -1.15, 0.78, 0.8).wheel(0.78, 0.6, -1.15, 0.78, -0.8);
      out.base = b.build();
      out.drum = k().cyl(0.78, 2.13, 0, 0, 0, STEEL, 'z', 16).cyl(0.5, 2.16, 0, 0, 0, 'B', 'z', 10).box(0.25, 1.4, 2.16, 0, 0, 0, '#3e4044').build();
      break;
    }
    case 'tandemRoller': {
      const b = k();
      b.engineBay(2.6, 0.9, 1.5, 0, 1.25, 0, 'B')
        .box(0.4, 0.8, 1.75, 1.35, 1.1, 0, 'B')
        .box(0.4, 0.8, 1.75, -1.35, 1.1, 0, 'B')
        .box(0.9, 0.5, 0.7, -0.2, 1.95, 0, DARK);
      for (const [x, z] of [
        [0.5, 0.65],
        [0.5, -0.65],
        [-0.6, 0.65],
        [-0.6, -0.65],
      ] as const)
        b.box(0.08, 1.3, 0.08, x, 2.35, z, DARK);
      b.box(1.4, 0.08, 1.6, -0.05, 3.0, 0, 'B');
      out.base = b.build();
      out.drum = k().cyl(0.6, 1.7, 0, 0, 0, STEEL, 'z', 16).box(0.2, 1.05, 1.72, 0, 0, 0, '#3e4044').build();
      break;
    }
    case 'paver': {
      const b = k();
      b.tracks(3.0, 0.6, 0.5, 2.0)
        .engineBay(2.8, 1.3, 2.4, -0.3, 1.25, 0, 'B')
        .box(1.6, 0.3, 2.2, 1.9, 0.75, 0, 'B')
        .box(1.6, 0.8, 0.12, 1.9, 1.2, 1.5, 'B', 0, 0)
        .box(1.6, 0.8, 0.12, 1.9, 1.2, -1.5, 'B')
        .box(1.4, 0.25, 2.0, 1.9, 0.98, 0, '#151515')
        .box(0.9, 0.55, 3.3, -2.05, 0.4, 0, '#c0a020')
        .box(0.9, 0.15, 3.3, -2.05, 0.72, 0, DARK)
        .box(1.0, 0.7, 0.6, -1.1, 2.25, 0.5, DARK);
      for (const [x, z] of [
        [-0.2, 1.2],
        [-0.2, -1.2],
        [-1.7, 1.2],
        [-1.7, -1.2],
      ] as const)
        b.box(0.08, 1.4, 0.08, x, 2.6, z, DARK);
      b.box(1.8, 0.1, 2.7, -0.95, 3.3, 0, 'B');
      out.base = b.build();
      break;
    }
    case 'tipper':
    case 'supplier':
    case 'flatbed': {
      const b = k();
      b.box(7.6, 0.35, 0.95, -0.2, 1.0, 0, DARK)
        .cab(1.9, 2.1, 2.45, 3.0, 2.25, 0)
        .box(0.08, 0.5, 2.3, 3.97, 1.4, 0, DARK)
        .box(1.1, 0.4, 2.45, 3.0, 0.95, 0, 'B');
      for (const x of (model === 'tipper4' ? [3.0, 1.7, -1.4, -2.8] : [3.0, -1.4, -2.8])) b.wheel(0.52, 0.45, x, 0.52, 1.0).wheel(0.52, 0.45, x, 0.52, -1.0);
      // tipping body: floor + walls (open top) in a darker shade of the truck colour
      const bed = cls === 'supplier' ? '#8b8f94' : 0.62;
      b.box(4.9, 0.18, 2.45, -0.75, 1.35, 0, bed);
      if (cls !== 'flatbed') b.box(4.9, 1.15, 0.1, -0.75, 1.95, 1.18, bed)
        .box(4.9, 1.15, 0.1, -0.75, 1.95, -1.18, bed)
        .box(0.12, 1.3, 2.45, 1.7, 2.0, 0, bed)
        .box(0.1, 1.15, 2.45, -3.18, 1.95, 0, bed);
      out.base = b.build();
      out.load = k().box(4.6, 1.0, 2.25, 0, 0, 0, '#ffffff').build();
      break;
    }
    case 'lowLoader': {
      const b = k();
      b.box(3.4, 0.35, 0.95, 4.2, 1.0, 0, DARK).cab(1.9, 2.2, 2.45, 5.0, 2.3, 0).box(10, 0.3, 2.5, -2.5, 0.9, 0, '#3a3c40');
      for (const x of [5.0, 3.6]) b.wheel(0.52, 0.45, x, 0.52, 1.0).wheel(0.52, 0.45, x, 0.52, -1.0);
      for (const x of [-5.0, -6.2, -7.4]) b.wheel(0.42, 0.4, x, 0.42, 1.0).wheel(0.42, 0.4, x, 0.42, -1.0);
      out.base = b.build();
      break;
    }
    case 'waterTruck': {
      const b = k();
      b.box(7.0, 0.35, 0.95, -0.2, 1.0, 0, DARK).cab(1.9, 2.1, 2.45, 2.7, 2.25, 0).cyl(1.05, 4.6, -1.0, 2.25, 0, 'B', 'x', 14);
      for (const x of [2.7, -1.6, -2.8]) b.wheel(0.52, 0.45, x, 0.52, 1.0).wheel(0.52, 0.45, x, 0.52, -1.0);
      out.base = b.build();
      break;
    }
    case 'surveyKit': {
      const b = k();
      b.part('case', () => b.box(.65, .18, .32, -.45, .1, 0, F('#d9bf39', 'plastic')));
      b.part('tripod', () => {
        for (let i = 0; i < 3; i += 1) {
          const a = i * Math.PI * 2 / 3;
          b.tube([0, 1.25, 0], [Math.cos(a) * .45, .02, Math.sin(a) * .45], .018, F('#d6b85a', 'metal'));
        }
      });
      b.part('receiver', () => b.cyl(.12, .10, 0, 1.32, 0, F('#e5bd24', 'plastic')));
      b.part('controller', () => b.box(.12, .16, .035, -.45, .23, 0, F('#263745', 'plastic')));
      out.base = b.build();
      break;
    }
    case 'van': {
      const b = k();
      b.box(3.4, 1.6, 1.95, -.7, 1.2, 0, 'B').engineBay(1.4, .7, 1.95, 1.7, .85, 0, 'B', 'bonnet').cab(1.1, .75, 1.9, .95, 1.82, 0);
      for (const x of [-1.5, 1.5]) for (const z of [-.85, .85]) b.wheel(.34, .22, x, .34, z);
      out.base = b.build();
      break;
    }
    // hand tools at their real size, lying on the ground (a knife is small: its label finds it); drawn in their side
    // view (x along the handle, y across, z the thickness) and laid flat
    case 'knife': {
      const t = k();
      t.part('blade', () => t.extrude(poly([[0, -0.009], [0.085, -0.009], [0.125, 0.004], [0.11, 0.009], [0, 0.011]]), 0.0025, 0, F('#c9ccd0', 'metal')));
      t.part('handle', () => { t.extrude(rrect(-0.11, -0.012, 0.112, 0.024, 0.009), 0.017, 0, F('#5b3a24', 'wood'), 0.003);
      for (const x of [-0.08, -0.035]) t.cyl(0.0028, 0.019, x, 0, 0, '#b8b8b0', 'z', 6);
      });
      out.base = lay(t);
      break;
    }
    case 'axe': {
      // a felling axe: a hickory haft, a forged head with its bright edge
      const t = k();
      t.part('handle', () => t.extrude(poly([[-0.36, -0.014], [0.0, -0.016], [0.3, -0.012], [0.33, 0.016], [0.0, 0.019], [-0.33, 0.022], [-0.37, 0.03], [-0.38, 0.012]]), 0.026, 0, F('#b48a55', 'wood'), 0.005));
      t.part('head', () => { t.extrude(poly([[0.27, 0.04], [0.345, 0.04], [0.35, -0.03], [0.405, -0.11], [0.415, -0.135], [0.24, -0.135], [0.25, -0.11], [0.27, -0.03]]), 0.03, 0, F('#2f3236', 'dull'), 0.004);
      t.extrude(poly([[0.243, -0.122], [0.413, -0.122], [0.416, -0.137], [0.24, -0.137]]), 0.012, 0, F('#d6d8db', 'metal'));
      });
      out.base = lay(t);
      break;
    }
    case 'saw': {
      // a bow saw: a tensioned blade on an orange steel bow
      const R = 0.42;
      const a = Math.asin(0.38 / R);
      const t = k();
      t.part('bow', () => t.ring(R, 0.012, 0, 0.24 - R, 0, F('#d4552c', 'paint'), 'z', 2 * a, 28, Math.PI / 2 - a));
      t.part('blade', () => { t.box(0.77, 0.022, 0.0015, 0, 0.008, 0, F('#b9bdc1', 'metal'));
      t.box(0.77, 0.004, 0.002, 0, -0.004, 0, F('#5a5e62', 'metal'));
      });
      t.part('grip', () => t.extrude(rrect(-0.4, -0.01, 0.07, 0.03, 0.01), 0.02, 0, F('#d4552c', 'paint')));
      out.base = lay(t);
      break;
    }
    case 'plateCompactor': {
      // a forward plate compactor (60–90 kg): its plate, the exciter, a small petrol engine under a guard frame, the guide handle
      const b = k().box(0.56, 0.05, 0.45, 0, 0.025, 0, F('#3d4145', 'dull')).add(new BoxGeometry(0.1, 0.05, 0.45).rotateZ(0.6).translate(0.3, 0.055, 0), F('#3d4145', 'dull'));
      b.cyl(0.09, 0.4, 0.02, 0.13, 0, F('#45494d', 'dull'), 'z', 12);
      b.box(0.34, 0.24, 0.3, -0.02, 0.32, 0, 'B').extrude(rrect(-0.16, 0.44, 0.22, 0.09, 0.03), 0.22, 0, 'B', 0.01);
      b.cyl(0.07, 0.04, 0.12, 0.33, 0.17, F('#2a2a2c', 'plastic'), 'z', 14).box(0.12, 0.1, 0.04, -0.1, 0.3, -0.17, F('#1f2022', 'dull'));
      for (const z of [-1, 1]) b.bar([[0.2, 0.06, z * 0.2], [0.2, 0.58, z * 0.2], [-0.22, 0.58, z * 0.2], [-0.22, 0.06, z * 0.2]], 0.012, F('#2b2c2e', 'dull'));
      for (const z of [-1, 1]) b.bar([[-0.25, 0.12, z * 0.16], [-0.62, 0.62, z * 0.21], [-0.82, 0.93, z * 0.23]], 0.015, F('#2b2c2e', 'dull'));
      b.tube([-0.82, 0.93, -0.25], [-0.82, 0.93, 0.25], 0.018, F('#1f1f20', 'rubber'));
      out.base = b.build();
      break;
    }
    case 'bicycle': {
      // a trekking bicycle: 28-inch wheels, a diamond frame, a rack with two panniers (25 kg)
      const b = k();
      const FR = F(color, 'gloss');
      const BK = F('#1b1b1c', 'rubber');
      const AL = F('#a7acb1', 'metal');
      for (const x of [-0.53, 0.55]) b.part(`wheel:${x}:0`, () => {
        b.ring(0.335, 0.019, x, 0.35, 0, BK, 'z', Math.PI * 2, 28).ring(0.305, 0.009, x, 0.35, 0, AL, 'z', Math.PI * 2, 28).cyl(0.022, 0.1, x, 0.35, 0, AL, 'z', 8);
        for (let i = 0; i < 12; i += 1) {
          const a = (i / 12) * Math.PI * 2;
          b.tube([x, 0.35, (i % 2 ? 1 : -1) * 0.03], [x + Math.cos(a) * 0.3, 0.35 + Math.sin(a) * 0.3, 0], 0.0018, AL, 3);
        }
      });
      const A: V3 = [-0.53, 0.35, 0];
      const B: V3 = [0, 0.3, 0];
      const S: V3 = [-0.13, 0.84, 0];
      const H: V3 = [0.44, 0.83, 0];
      const HB: V3 = [0.47, 0.67, 0];
      b.tube(B, S, 0.016, FR).tube(S, H, 0.016, FR).tube(B, HB, 0.02, FR).tube(H, HB, 0.019, FR);
      for (const z of [-0.055, 0.055]) b.tube([A[0], A[1], z], [B[0], B[1], z * 0.4], 0.009, FR).tube([A[0], A[1], z], [S[0], S[1] - 0.02, z * 0.3], 0.009, FR).tube([HB[0], HB[1], z * 0.6], [0.55, 0.35, z], 0.011, FR);
      b.tube([-0.135, 0.84, 0], [-0.15, 0.95, 0], 0.012, AL).add(new BoxGeometry(0.26, 0.05, 0.14).translate(-0.17, 0.97, 0), F('#1c1c1d', 'plastic'));
      b.tube(H, [0.41, 0.98, 0], 0.014, AL).tube([0.41, 0.98, -0.3], [0.41, 0.98, 0.3], 0.011, AL);
      for (const z of [-1, 1]) b.tube([0.41, 0.98, z * 0.3], [0.41, 0.98, z * 0.22], 0.016, F('#1c1c1d', 'rubber'));
      b.ring(0.1, 0.008, 0, 0.3, 0.06, AL, 'z', Math.PI * 2, 18).box(0.1, 0.02, 0.08, 0.17, 0.2, 0.1, F('#1c1c1d', 'plastic')).box(0.1, 0.02, 0.08, -0.17, 0.4, -0.1, F('#1c1c1d', 'plastic'));
      // the rack and its panniers
      b.box(0.42, 0.015, 0.14, -0.53, 0.74, 0, F('#2b2c2e', 'dull'));
      for (const z of [-1, 1]) {
        b.tube([-0.33, 0.74, z * 0.07], [-0.53, 0.36, z * 0.07], 0.007, F('#2b2c2e', 'dull'));
        b.extrude(rrect(-0.72, 0.4, 0.36, 0.34, 0.05), 0.13, z * 0.15, F('#24425e', 'nylon'), 0.02);
      }
      out.base = b.build();
      break;
    }
    case 'car': {
      // an estate car (some 4.7 × 1.8 × 1.5 m): its body with wheel arches, the glasshouse, pillars, lights and bumpers
      const b = k();
      // (from the rear bottom along the sill, up over each wheel arch and down, then round by the nose and the roofline)
      const outline: [number, number][] = [[-2.36, .32], [-1.84, .29]];
      for (let i = 10; i >= 0; i -= 1) outline.push([-1.42 + Math.cos(Math.PI * i / 10) * .4, .33 + Math.sin(Math.PI * i / 10) * .4]);
      outline.push([-.99, .29], [.8, .29], [.8, .98], [-2.3, .98], [-2.37, .62]);
      b.part('shell', () => b.extrude(poly(outline), 1.8, 0, F(color, 'gloss'), .03));
      b.part('chassis', () => b.box(4.6, .10, 1.35, 0, .28, 0, DARK));
      // Thin wing panels follow the front wheel arch, leaving a real empty engine bay.
      b.box(1.52, .045, 1.8, 1.56, .4, 0, 'B');
      for (const x of [.82, 2.30]) b.box(.04, .5, 1.8, x, .65, 0, 'B');
      const wing: [number, number][] = [[.8, .4], [1.0, .4]];
      for (let i = 10; i >= 0; i -= 1) wing.push([1.42 + Math.cos(Math.PI * i / 10) * .4, .33 + Math.sin(Math.PI * i / 10) * .4]);
      wing.push([2.30, .4], [2.30, .9], [.8, .9]);
      for (const z of [-.88, .88]) b.extrude(poly(wing), .04, z, F(color, 'gloss'));
      b.part('bonnet', () => b.box(1.52, .045, 1.8, 1.56, .92, 0, 'B'));

      b.extrude(poly([[-2.24, 0.96], [-2.17, 1.4], [0.32, 1.47], [1.3, 0.97]]), 1.6, 0, F('#1d2a33', 'glass'), 0.03);
      b.extrude(poly([[-2.22, 1.37], [-2.18, 1.47], [0.3, 1.53], [0.5, 1.46], [0.3, 1.45]]), 1.56, 0, F(color, 'gloss'), 0.03);
      for (const x of [-0.42, -1.5]) b.box(0.1, 0.5, 1.62, x, 1.22, 0, F(color, 'gloss'));
      for (const z of [-1, 1]) {
        b.tube([1.3, 0.98, z * 0.78], [0.33, 1.47, z * 0.72], 0.045, F(color, 'gloss'), 8);
        b.box(0.14, 0.09, 0.08, 1.12, 1.05, z * 0.96, F(color, 'gloss'));
        b.box(0.08, 0.13, 0.42, 2.33, 0.76, z * 0.58, F('#e9ecef', 'lens'));
        b.box(0.06, 0.32, 0.22, -2.36, 0.86, z * 0.7, F('#8e1414', 'lens'));
        b.box(1.9, 0.1, 0.03, 0, 0.36, z * 0.9, F('#1f2022', 'plastic'));
        b.box(0.05, 0.04, 0.2, 0.25, 0.82, z * 0.905, F('#9da2a6', 'metal'));
        b.box(0.05, 0.04, 0.2, -0.95, 0.82, z * 0.905, F('#9da2a6', 'metal'));
      }
      b.box(0.08, 0.16, 0.9, 2.36, 0.57, 0, F('#1a1b1c', 'plastic')).box(0.12, 0.17, 1.84, 2.34, 0.36, 0, F('#202123', 'plastic')).box(0.12, 0.17, 1.84, -2.34, 0.4, 0, F('#202123', 'plastic'));
      b.box(0.02, 0.11, 0.52, 2.41, 0.38, 0, F('#f1f1ec', 'plastic')).box(0.02, 0.11, 0.52, -2.41, 0.62, 0, F('#f1f1ec', 'plastic'));
      for (const x of [1.42, -1.42]) for (const z of [-0.79, 0.79]) b.part(`wheel:${x}:${z}`, () => b.cyl(0.33, 0.22, x, 0.33, z, F('#1b1b1c', 'rubber'), 'z', 20).cyl(0.21, 0.225, x, 0.33, z, F('#b9bec3', 'metal'), 'z', 14).cyl(0.07, 0.23, x, 0.33, z, F('#5a5e62', 'metal'), 'z', 8));
      out.base = b.build();
      break;
    }
    case 'caravan': {
      // a touring caravan (5.6 m body, 2.3 m wide): a white shell with rounded corners and a stripe, tinted windows,
      // the door on its kerb side, a gas locker, the A-frame drawbar with its jockey wheel, one axle under a skirt
      const b = k();
      const shell = new Shape();
      shell.moveTo(-2.55, 0.45);
      shell.lineTo(2.5, 0.45);
      shell.quadraticCurveTo(2.86, 0.5, 2.86, 0.95);
      shell.lineTo(2.8, 2.25);
      shell.quadraticCurveTo(2.75, 2.62, 2.3, 2.62);
      shell.lineTo(-2.5, 2.62);
      shell.quadraticCurveTo(-2.8, 2.62, -2.8, 2.32);
      shell.lineTo(-2.8, 0.72);
      shell.quadraticCurveTo(-2.8, 0.45, -2.55, 0.45);
      b.part('shell', () => b.extrude(shell, 2.3, 0, F('#f2efe8', [0.4, 0.05, 0]), 0.05));
      const DEC = F('#56677a', [0.45, 0.1, 0]);
      for (const z of [-1, 1]) {
        b.box(5.3, 0.14, 0.02, 0, 1.22, z * 1.155, DEC).box(5.5, 0.22, 0.02, 0, 0.58, z * 1.155, F('#9aa1a8', [0.5, 0.1, 0]));
        for (const [x, w] of [[-1.9, 0.95], [-0.2, 0.8], [1.55, 1.1]] as const) {
          if (z > 0 && x === -0.2) continue;
          b.extrude(rrect(x - w / 2 - 0.05, 1.42, w + 0.1, 0.68, 0.1), 0.02, z * 1.16, F('#3a3f44', 'plastic')).extrude(rrect(x - w / 2, 1.47, w, 0.58, 0.08), 0.02, z * 1.17, F('#2a333a', 'glass'));
        }
      }
      // the door, on the kerb side
      b.extrude(rrect(-0.5, 0.62, 0.62, 1.82, 0.08), 0.03, 1.165, F('#ece8df', [0.4, 0.05, 0])).extrude(rrect(-0.4, 1.6, 0.42, 0.45, 0.06), 0.02, 1.185, F('#2a333a', 'glass')).box(0.12, 0.03, 0.03, 0.03, 1.3, 1.19, F('#9da2a6', 'metal'));
      b.box(0.03, 0.62, 1.7, 2.84, 1.82, 0, F('#2a333a', 'glass')).box(0.4, 0.3, 1.2, 2.72, 0.75, 0, F('#e6e2d8', [0.45, 0.05, 0]));
      b.box(0.62, 0.1, 0.62, 0.3, 2.66, 0, F('#d9dde0', 'plastic')).box(0.4, 0.1, 0.4, -1.6, 2.65, 0.4, F('#d9dde0', 'plastic'));
      for (const z of [-1, 1]) b.box(0.05, 0.32, 0.22, -2.83, 0.85, z * 0.95, F('#8e1414', 'lens'));
      for (const z of [-1, 1]) b.tube([2.6, 0.5, z * 0.62], [3.75, 0.48, 0], 0.045, F('#8f949a', 'galv'), 8);
      b.box(0.3, 0.12, 0.14, 3.86, 0.5, 0, F('#202124', 'dull')).tube([3.45, 0.62, 0.14], [3.45, 0.06, 0.14], 0.025, F('#8f949a', 'galv')).cyl(0.07, 0.05, 3.45, 0.07, 0.14, F('#1c1c1d', 'rubber'), 'z', 12);
      for (const x of [-2.6, 2.4]) for (const z of [-1, 1]) b.tube([x, 0.46, z * 0.95], [x, 0.05, z * 0.95], 0.025, F('#2a2b2d', 'dull'));
      b.wheel(0.32, 0.2, -0.1, 0.32, 1.02).wheel(0.32, 0.2, -0.1, 0.32, -1.02);
      out.base = b.build();
      break;
    }
    case 'siteTrailer': {
      // a construction trailer (Bauwagen, 6 × 2.5 m): a box of boards on a steel chassis, a curved felt roof, two
      // small windows a side, a door with steps at the end, its stove pipe
      const b = k();
      b.box(5.8, 0.18, 1.4, 0, 0.62, 0, F('#2a2b2d', 'dull'));
      b.part('body', () => b.box(6, 2.0, 2.5, 0, 1.72, 0, F('#577a4c', 'boards')));
      const roof = new Shape();
      roof.moveTo(-1.32, 0);
      roof.quadraticCurveTo(0, 0.55, 1.32, 0);
      roof.lineTo(1.32, -0.06);
      roof.quadraticCurveTo(0, 0.49, -1.32, -0.06);
      roof.closePath();
      b.part('roof', () => b.add(new ExtrudeGeometry(roof, { depth: 6.2, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -3.1).rotateY(Math.PI / 2).translate(0, 2.74, 0), F('#3a3b3c', [0.9, 0, PATTERN.rough])));
      for (const s of [-1, 1]) b.add(new ExtrudeGeometry(poly([[-1.25, 0], [0, 0.48], [1.25, 0]]), { depth: 0.02, bevelEnabled: false }).rotateY(Math.PI / 2).translate(s * 3.005, 2.72, 0), F('#577a4c', 'boards'));
      for (const z of [-1, 1]) {
        for (const x of [-1.6, 1.4]) b.box(0.9, 0.7, 0.03, x, 2.0, z * 1.26, F('#ecebe6', 'paint')).box(0.75, 0.56, 0.03, x, 2.0, z * 1.27, F('#26313a', 'glass'));
        b.box(5.9, 0.06, 0.03, 0, 0.73, z * 1.265, F('#3c5636', 'boards'));
      }
      b.box(0.04, 1.85, 0.85, 3.02, 1.62, 0.55, F('#466a3d', 'boards')).box(0.04, 0.03, 0.08, 3.05, 1.6, 0.25, F('#9da2a6', 'metal'));
      for (let i = 0; i < 3; i += 1) b.box(0.26, 0.04, 0.8, 3.18 + i * 0.26, 0.6 - i * 0.2, 0.55, F('#8a6b47', 'wood'));
      b.tube([-2.3, 2.9, 0.6], [-2.3, 3.6, 0.6], 0.06, F('#4a4d50', 'dull'), 10).cyl(0.12, 0.05, -2.3, 3.63, 0.6, F('#3d4043', 'dull'), 'y', 10);
      b.tube([3.0, 0.6, 0], [4.0, 0.5, 0], 0.06, F('#2a2b2d', 'dull')).ring(0.08, 0.02, 4.05, 0.5, 0, F('#2a2b2d', 'dull'), 'y');
      for (const x of [-1.8, 1.8]) b.wheel(0.36, 0.22, x, 0.36, 1.0).wheel(0.36, 0.22, x, 0.36, -1.0);
      out.base = b.build();
      break;
    }
    case 'powerStation': {
      const b = k();
      b.part('batteryEnclosure', () => b.box(.32, .25, .22, 0, .145, 0, F('#354450', 'plastic')));
      b.part('controlPanel', () => b.box(.24, .12, .012, .02, .18, .116, F('#111b23', 'plastic')));
      b.part('handle', () => b.bar([[-.1, .27, 0], [-.1, .32, 0], [.1, .32, 0], [.1, .27, 0]], .014, F('#20272c', 'rubber')));
      for (const x of [-.08, .08]) b.cyl(.022, .014, x, .16, .13, F('#78828a', 'metal'), 'z');
      out.base = b.build(); break;
    }
    case 'solarPanel': {
      const b = k();
      for (const x of [-.3, .3]) {
        b.part(`panel:${x}`, () => {
          b.box(.58, .025, .65, x, .25, 0, F('#23384f', 'glass'), -.7);
          for (let i = 0; i < 5; i += 1) b.box(.003, .028, .65, x - .24 + i * .12, .25, 0, F('#7795aa', 'metal'), -.7);
        });
      }
      b.part('stand', () => { for (const x of [-.5, .5]) b.bar([[x, .02, -.22], [x, .45, -.2], [x, .02, .32]], .012, F('#36404a', 'metal')); });
      out.base = b.build(); break;
    }
    case 'generator': {
      const b = k();
      b.part('chassis', () => b.box(.55, .055, .36, 0, .035, 0, DARK));
      // Real opening on the service side: the four-stroke unit is not inside a solid box.
      b.part('housing', () => {
        for (const x of [-.26, .26]) b.box(.025, .38, .36, x, .25, 0, 'B');
        b.box(.52, .035, .36, 0, .45, 0, 'B').box(.52, .38, .025, 0, .25, -.17, 'B');
      });
      b.part('serviceCover', () => b.box(.49, .34, .025, 0, .25, .18, 'B'));
      b.part('fuelTank', () => b.box(.22, .07, .24, .12, .39, 0, F('#2a3033', 'plastic')));
      b.part('alternator', () => b.cyl(.10, .12, .15, .2, 0, STEEL, 'x'));
      b.part('handle', () => b.tube([-.16, .49, 0], [.16, .49, 0], .022, F('#252b2e', 'rubber')));
      out.base = b.build(); break;
    }
    case 'lightTower': {
      const b = k();
      b.part('chassis', () => b.box(2.1, .16, 1.1, -.1, .4, 0, DARK));
      b.wheel(.30, .18, -.2, .30, -.6).wheel(.30, .18, -.2, .30, .6);
      b.engineBay(1.4, .8, .9, -.3, .8, 0, 'B');
      b.part('drawbar', () => b.bar([[.7, .4, -.4], [1.9, .32, 0], [.7, .4, .4]], .04, STEEL));
      b.part('mast', () => { b.box(.16, 3.2, .16, .55, 2, 0, STEEL); b.box(.11, 2.6, .11, .55, 4.5, 0, STEEL); });
      b.part('lamps', () => {
        b.box(.12, .08, 1.5, .55, 5.8, 0, STEEL);
        for (const z of [-.6, -.2, .2, .6]) b.box(.12, .25, .30, .61, 5.77, z, DARK).box(.015, .19, .25, .68, 5.77, z, LIGHT);
      });
      b.part('supports', () => { for (const z of [-1, 1]) for (const x of [-.9, .6]) b.bar([[x, .4, z * .4], [x, .2, z * .95], [x, .02, z * .95]], .025, STEEL); });
      out.base = b.build(); break;
    }
    case 'mixer': {
      const b = k();
      b.box(7.2, .35, .95, 0, 1, 0, DARK).cab(1.9, 2.1, 2.45, 2.7, 2.25, 0);
      b.cyl(1.15, 3.8, -1, 2.3, 0, 'B', 'x', 20).box(.5, .12, .5, -3.2, 1.2, 0, STEEL);
      for (const x of [2.7, -1.6, -2.8]) for (const z of [-1, 1]) b.wheel(.52, .45, x, .52, z);
      out.base = b.build();
      break;
    }
    case 'foot': {
      const b = k();
      for (const z of [-.10, .10]) b.capsule(.065, .64, 0, .39, z, '#3c444b');
      b.box(.27, .52, .40, 0, 1.06, 0, 'B').sphere(.13, 0, 1.53, 0, '#cba786');
      for (const z of [-.26, .26]) b.capsule(.055, .44, 0, 1.02, z, 'B');
      out.base = b.build();
      break;
    }
    default:
      // An unmistakable diagnostic cross, never a fabricated vehicle.
      out.base = k().box(.04, .45, .04, 0, .24, 0, '#ff00b8', .75).box(.04, .45, .04, 0, .24, 0, '#ff00b8', -.75).build();
  }
  cache.set(key, out);
  return out;
}

export function buildMachine(cls: string, color: string, mat: Material, loadMat: Material, model = cls): MachineRig {
  const p = parts(cls, color, model);
  const root = new Group();
  const body = new Group();
  root.add(body);
  const meshes: Mesh[] = [];
  const mk = (g: BufferGeometry, parent: Group, m: Material = mat) => {
    const mesh = new Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    meshes.push(mesh);
    for (const part of (g.userData.components ?? []) as { id: string; geometry: BufferGeometry; origin: number[] }[]) {
      const mount = new Group();
      mount.name = `mount:${part.id}`;
      mount.position.set(part.origin[0]!, part.origin[1]!, part.origin[2]!);
      parent.add(mount);
      rig.mounts.set(part.id, mount);
      replaceMachineComponent(rig, part.id, part.geometry, m);
    }
    return mesh;
  };
  const rig: MachineRig = { root, body, meshes, size: 6, cls, mounts: new Map(), components: new Map() };
  const asset = equipmentAsset(model, cls);
  if (asset) {
    for (const part of itemParts(asset)) {
      const mount = new Group();
      mount.name = `mount:${part.id}`;
      mount.position.set(part.origin[0]!, part.origin[1]!, part.origin[2]!);
      body.add(mount);
      rig.mounts.set(part.id, mount);
      replaceMachineComponent(rig, part.id, part.geometry, mat);
    }
  } else if (p.base) {
    const base = mk(p.base, body);
    // Some recipes already have a separate body panel; the residual fittings must not overwrite it.
    const id = rig.components.has('body') ? 'fittings' : 'body';
    base.name = id;
    rig.components.set(id, base);
    rig.mounts.set(id, body);
  }
  const attach = (id: string, geometry: BufferGeometry, mount: Group) => {
    rig.mounts.set(id, mount);
    const mesh = mk(geometry, mount);
    mesh.name = `component:${id}`;
    mesh.userData.component = id;
    rig.components.set(id, mesh);
    return mesh;
  };
  if (p.house) {
    const house = new Group();
    house.position.set(0, 1.25, 0);
    body.add(house);
    attach('house', p.house, house);
    const boom = new Group();
    boom.position.set(0.9, 0.9, -0.25);
    house.add(boom);
    attach('boom', p.boom!, boom);
    const stick = new Group();
    stick.position.set(5.5, 0, 0);
    boom.add(stick);
    attach('stick', p.stick!, stick);
    const bucket = new Group();
    bucket.position.set(2.95, 0, 0);
    stick.add(bucket);
    attach('bucket', p.bucket!, bucket);
    Object.assign(rig, { house, boom, stick, bucket, size: 9 });
    boom.rotation.z = 0.55;
    stick.rotation.z = -1.95;
    bucket.rotation.z = -0.9;
  }
  if (p.arms) {
    const arms = new Group();
    arms.position.set(0.3, 1.85, 0);
    body.add(arms);
    attach('armsAndBucket', p.arms, arms);
    arms.rotation.z = -0.35;
    rig.arms = arms;
    rig.size = 8;
  }
  if (p.blade) {
    const blade = new Group();
    if (cls === 'dozer') blade.position.set(2.55, 0.78, 0);
    else {
      blade.position.set(1.7, 0.4, 0);
      blade.rotation.y = 0.55;
    }
    body.add(blade);
    attach('blade', p.blade, blade);
    rig.blade = blade;
    rig.size = cls === 'grader' ? 9.5 : 6;
  }
  if (p.drum) {
    rig.drums = [];
    const xs = cls === 'tandemRoller' ? [1.35, -1.35] : [1.6];
    const r = cls === 'tandemRoller' ? 0.6 : 0.78;
    for (const x of xs) {
      const d = new Group();
      d.position.set(x, r, 0);
      body.add(d);
      attach(`drum:${x}`, p.drum, d);
      rig.drums.push(d);
    }
  }
  if (p.load) {
    const m = new Mesh(p.load, loadMat);
    m.position.set(-0.75, 1.95, 0);
    m.castShadow = true;
    m.visible = false;
    body.add(m);
    meshes.push(m);
    rig.load = m;
    rig.size = 9;
  }
  if (cls === 'miniExcavator') {
    body.scale.setScalar(0.45);
    rig.size = 4;
  }
  if (['knife', 'axe', 'saw'].includes(cls)) rig.size = 1;
  if (cls === 'bicycle' || cls === 'plateCompactor' || cls === 'powerStation' || cls === 'generator' || cls === 'solarPanel') rig.size = 1.6;
  if (cls === 'caravan' || cls === 'siteTrailer') rig.size = 6.5;
  const engine = engineMounts[cls];
  if (engine) {
    const mount = new Group();
    mount.name = 'mount:engine';
    mount.position.set(...engine.position);
    mount.scale.setScalar(engine.scale);
    (engine.parent === 'house' ? rig.house! : body).add(mount);
    rig.mounts.set('engine', mount);
    replaceMachineComponent(rig, 'engine', itemGeometry(engine.asset), mat);
  }
  if (asset) rig.size = Math.max(...assetSize(asset));
  else if (cls === 'foot' || !knownMachineClasses.has(cls)) rig.size = .6;
  root.userData.visual = asset ?? (knownMachineClasses.has(cls) ? cls : 'missing');
  if (cls === 'lowLoader') rig.size = 14;
  return rig;
}

/** Asset-level assembly editing, used by the model preview. Gameplay must enforce physical work. */
export function replaceMachineComponent(rig: MachineRig, id: string, geometry: BufferGeometry | null, mat: Material): void {
  const mount = rig.mounts.get(id);
  if (!mount) throw new Error(`No attachment point for ${id}`);
  const old = rig.components.get(id);
  if (old) {
    mount.remove(old);
    rig.meshes.splice(rig.meshes.indexOf(old), 1);
    rig.components.delete(id);
  }
  if (!geometry) return;
  const mesh = new Mesh(geometry, mat);
  mesh.name = `component:${id}`;
  mesh.userData.component = id;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mount.add(mesh);
  rig.meshes.push(mesh);
  rig.components.set(id, mesh);
}

/** animate articulated parts; t = seconds, phase offsets per machine */
export function animateRig(rig: MachineRig, t: number, working: boolean, moving: boolean, seed: number): void {
  const w = working ? 1 : 0;
  if (rig.house && rig.boom && rig.stick && rig.bucket) {
    if (working) {
      // dig → lift → swing → dump → swing back (~16 s cycle)
      const c = ((t + seed * 7) % 16) / 16;
      const swing = c < 0.35 ? 0 : c < 0.5 ? (c - 0.35) / 0.15 : c < 0.7 ? 1 : c < 0.85 ? 1 - (c - 0.7) / 0.15 : 0;
      rig.house.rotation.y = swing * 1.6 * (seed > 0.5 ? 1 : -1);
      const dig = c < 0.35 ? c / 0.35 : 1;
      rig.boom.rotation.z = c < 0.35 ? 0.25 + 0.1 * Math.sin(dig * Math.PI) : 0.7;
      rig.stick.rotation.z = c < 0.35 ? -1.2 - dig * 0.8 : -1.6;
      rig.bucket.rotation.z = c < 0.35 ? -0.3 - dig * 1.2 : c > 0.55 && c < 0.7 ? 0.4 : -1.5;
    } else {
      rig.house.rotation.y *= 0.95;
      rig.boom.rotation.z = 0.55;
      rig.stick.rotation.z = -1.95;
      rig.bucket.rotation.z = -0.9;
    }
  }
  if (rig.arms) rig.arms.rotation.z = working ? -0.35 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.8 + seed * 6)) : -0.35;
  if (rig.blade && rig.cls === 'dozer') rig.blade.position.y = 0.78 + w * 0.06 * Math.sin(t * 1.3 + seed * 5);
  if (rig.drums && (working || moving)) for (const d of rig.drums) d.rotation.z -= 0.03;
  // engine vibration
  rig.body.position.y = working && knownMachineClasses.has(rig.cls) && rig.cls !== 'foot' ? 0.012 * Math.sin(t * 40 + seed * 10) : 0;
}
