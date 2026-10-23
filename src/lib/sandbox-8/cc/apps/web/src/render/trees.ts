/**
 * Trees as chunked InstancedMeshes (per kind and map chunk) so the frustum culls whole chunks and
 * distant chunks switch to a low-poly geometry. Trunk and crown are one geometry; a per-vertex
 * `aPart` attribute (−1 = trunk, else crown brightness) keeps the trunk brown under the per-instance
 * species colour.
 */
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TreeArrays } from '../protocol.ts';
import { hash2 } from './colors.ts';
import type { Heightfield } from './heightfield.ts';

const CHUNK = 320;
const LOD_DIST = 520;

function tagPart(g: BufferGeometry, part: number | ((y: number) => number)): BufferGeometry {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n);
  const pos = g.getAttribute('position');
  for (let i = 0; i < n; i += 1) a[i] = typeof part === 'number' ? part : part(pos.getY(i));
  g.setAttribute('aPart', new Float32BufferAttribute(a, 1));
  return g;
}

function clean(g: BufferGeometry): BufferGeometry {
  // keep position/normal/aPart only so geometries merge
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'aPart') g.deleteAttribute(k);
  return g;
}

function lumpy(detail: number, sx: number, sy: number, sz: number, cx: number, cy: number, cz: number, seed: number): BufferGeometry {
  let g: BufferGeometry = new IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = 0.86 + 0.28 * hash2(Math.round(x * 97 + seed * 13), Math.round(z * 89 + y * 41));
    p.setXYZ(i, cx + x * sx * n, cy + y * sy * n, cz + z * sz * n);
  }
  g.computeVertexNormals();
  return g;
}

/** unit tree: height 1, crown radius 1 (scaled per instance: x/z by crown radius, y by height) */
function broadleaf(lod: 0 | 1): BufferGeometry {
  const trunk = tagPart(clean(new CylinderGeometry(0.07, 0.11, 0.5, lod ? 4 : 6, 1, true).translate(0, 0.25, 0)), -1);
  const ao = (y: number) => 0.62 + 0.45 * Math.min(1, Math.max(0, (y - 0.3) / 0.65));
  if (lod) {
    const c = tagPart(lumpy(0, 1, 0.38, 1, 0, 0.62, 0, 1), ao);
    return mergeGeometries([trunk, clean(c)])!;
  }
  // a crown of several masses of foliage over the main limbs that carry them
  const limbs = [[0.45, 0.62, 0.3], [-0.4, 0.66, -0.25], [0.05, 0.72, -0.45]].map(([x, y, z], i) => {
    const g = new CylinderGeometry(0.025, 0.05, 0.42, 4, 1, true).translate(0, 0.21, 0);
    g.rotateZ(-Math.atan2(x!, y! - 0.45) * 0.9).rotateY(i * 2.1);
    return tagPart(clean(g.translate(0, 0.45, 0)), -1);
  });
  const c1 = tagPart(lumpy(1, 0.78, 0.32, 0.78, 0.12, 0.58, 0.08, 1), ao);
  const c2 = tagPart(lumpy(1, 0.6, 0.27, 0.58, -0.3, 0.74, -0.22, 2), ao);
  const c3 = tagPart(lumpy(1, 0.55, 0.25, 0.55, 0.28, 0.8, -0.3, 3), ao);
  return mergeGeometries([trunk, ...limbs, clean(c1), clean(c2), clean(c3)])!;
}

function conifer(lod: 0 | 1): BufferGeometry {
  const seg = lod ? 5 : 8;
  const trunk = tagPart(clean(new CylinderGeometry(0.05, 0.09, 0.3, lod ? 4 : 5, 1, true).translate(0, 0.15, 0)), -1);
  const ao = (y: number) => 0.6 + 0.5 * Math.min(1, Math.max(0, (y - 0.1) / 0.9));
  const parts = [trunk];
  if (lod) {
    parts.push(tagPart(clean(new ConeGeometry(1, 0.88, seg, 1, true).translate(0, 0.12 + 0.44, 0)), ao));
  } else {
    // a spruce: whorls of drooping branches, wide at the bottom, their tips ragged, to a narrow top
    const tiers = 5;
    for (let i = 0; i < tiers; i += 1) {
      const f = i / tiers;
      const r = 1 - f * 0.84;
      const h = 0.34 - f * 0.1;
      const y0 = 0.14 + f * 0.72;
      const g = new ConeGeometry(r, h, 12, 1, true);
      const ps = g.getAttribute('position');
      for (let j = 0; j < ps.count; j += 1) {
        if (ps.getY(j) > 0) continue;
        const a = Math.atan2(ps.getZ(j), ps.getX(j));
        const tip = 0.5 + 0.5 * Math.cos(a * 6 + i * 1.7);
        const k = 0.78 + 0.26 * tip;
        ps.setXYZ(j, ps.getX(j) * k, ps.getY(j) - 0.05 * tip, ps.getZ(j) * k);
      }
      g.computeVertexNormals();
      parts.push(tagPart(clean(g.rotateY(i * 0.9).translate(0, y0 + h / 2, 0)), ao));
    }
  }
  return mergeGeometries(parts)!;
}

interface Chunk {
  cx: number;
  cz: number;
  meshes: InstancedMesh[];
  /** [high, low] geometry per mesh */
  geos: [BufferGeometry, BufferGeometry][];
  lod: number;
}

export class TreeLayer {
  readonly group = new Group();
  private mat: MeshStandardMaterial;
  private geos: [BufferGeometry, BufferGeometry][];
  private chunks: Chunk[] = [];
  revision = -1;
  count = 0;
  private castShadows = true;
  private tmpV = new Vector3();

  constructor() {
    this.mat = new MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    this.mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPart;')
        .replace(
          '#include <color_vertex>',
          `#include <color_vertex>
          #ifdef USE_INSTANCING_COLOR
          if (aPart < 0.0) vColor.xyz = vec3(0.18, 0.13, 0.09);
          else vColor.xyz *= aPart;
          #endif
          vLeaf = aPart < 0.0 ? 0.0 : 1.0;
          vTreePos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;`,
        )
        .replace('#include <common>', '#include <common>\nvarying float vLeaf;\nvarying vec3 vTreePos;');
      // leaves in clumps: light and shade dappled over the crown, fading with distance (no shimmer far off)
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vLeaf;
          varying vec3 vTreePos;
          float th(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
          float tn(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(th(i), th(i + vec3(1, 0, 0)), f.x), mix(th(i + vec3(0, 1, 0)), th(i + vec3(1, 1, 0)), f.x), f.y),
                       mix(mix(th(i + vec3(0, 0, 1)), th(i + vec3(1, 0, 1)), f.x), mix(th(i + vec3(0, 1, 1)), th(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float near = 1.0 - clamp(vViewPosition.z / 260.0, 0.0, 1.0);
          float leaf = tn(vTreePos * 1.6) * 0.6 + tn(vTreePos * 5.0) * 0.4;
          diffuseColor.rgb *= mix(1.0, 0.72 + 0.56 * leaf, vLeaf * near);`);
    };
    this.geos = [
      [broadleaf(0), broadleaf(1)],
      [conifer(0), conifer(1)],
    ];
    this.group.name = 'trees';
  }

  set(trees: TreeArrays, hf: Heightfield): void {
    this.clear();
    this.revision = trees.revision;
    const n = trees.kind.length;
    this.count = n;
    const g = hf.grid;
    const ncx = Math.max(1, Math.ceil((hf.x1 - g.x0) / CHUNK));
    const ncz = Math.max(1, Math.ceil((hf.z1 - g.z0) / CHUNK));
    // bucket by chunk and kind
    const buckets = new Map<number, number[]>();
    for (let t = 0; t < n; t += 1) {
      const x = trees.data[t * 4]!;
      const z = trees.data[t * 4 + 1]!;
      const ci = Math.min(ncx - 1, Math.max(0, Math.floor((x - g.x0) / CHUNK)));
      const cj = Math.min(ncz - 1, Math.max(0, Math.floor((z - g.z0) / CHUNK)));
      const key = (cj * ncx + ci) * 2 + (trees.kind[t] === 1 ? 1 : 0);
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(t);
    }
    const speciesCol = trees.speciesColors.map((c) => new Color(c));
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    const up = new Vector3(0, 1, 0);
    const c = new Color();
    const chunkMap = new Map<number, Chunk>();
    for (const [key, list] of buckets) {
      const kind = key % 2;
      const cid = (key - kind) / 2;
      const ci = cid % ncx;
      const cj = (cid - ci) / ncx;
      let chunk = chunkMap.get(cid);
      if (!chunk) {
        chunk = { cx: g.x0 + (ci + 0.5) * CHUNK, cz: g.z0 + (cj + 0.5) * CHUNK, meshes: [], geos: [], lod: 0 };
        chunkMap.set(cid, chunk);
        this.chunks.push(chunk);
      }
      const geos = this.geos[kind]!;
      const mesh = new InstancedMesh(geos[0], this.mat, list.length);
      for (let k = 0; k < list.length; k += 1) {
        const t = list[k]!;
        const x = trees.data[t * 4]!;
        const z = trees.data[t * 4 + 1]!;
        const h = Math.max(1.5, trees.data[t * 4 + 2]!);
        const r = Math.max(0.6, trees.data[t * 4 + 3]!);
        const rnd = hash2(Math.round(x * 10), Math.round(z * 10));
        q.setFromAxisAngle(up, rnd * Math.PI * 2);
        const rr = kind === 1 ? r * 1.45 : r * 1.4;
        s.set(rr, h, rr * (0.92 + 0.16 * rnd));
        // sink slightly so trunks never float on slopes
        p.set(x, hf.y(x, z) - 0.25, z);
        m.compose(p, q, s);
        mesh.setMatrixAt(k, m);
        const sp = speciesCol[trees.species[t]!] ?? c.set('#4f7a3a');
        c.copy(sp);
        const v = 0.86 + 0.26 * hash2(Math.round(z * 7), Math.round(x * 3));
        c.multiplyScalar(v);
        c.offsetHSL((rnd - 0.5) * 0.03, 0, 0);
        mesh.setColorAt(k, c);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = this.castShadows;
      mesh.receiveShadow = true;
      mesh.name = kind ? 'conifers' : 'broadleaves';
      chunk.meshes.push(mesh);
      chunk.geos.push(geos);
      this.group.add(mesh);
    }
  }

  setShadows(on: boolean): void {
    this.castShadows = on;
    for (const ch of this.chunks) for (const m of ch.meshes) m.castShadow = on && ch.lod === 0;
  }

  /** per frame: LOD by distance from camera to chunk centre */
  update(camera: PerspectiveCamera): void {
    const cam = camera.position;
    for (const ch of this.chunks) {
      const d = this.tmpV.set(ch.cx - cam.x, 0, ch.cz - cam.z).length() - CHUNK * 0.7;
      const dist = Math.hypot(d > 0 ? d : 0, cam.y);
      const lod = dist > LOD_DIST ? 1 : 0;
      if (lod !== ch.lod) {
        ch.lod = lod;
        for (let i = 0; i < ch.meshes.length; i += 1) {
          const mesh = ch.meshes[i]!;
          mesh.geometry = ch.geos[i]![lod]!;
          mesh.castShadow = this.castShadows && lod === 0;
        }
      }
    }
  }

  clear(): void {
    for (const ch of this.chunks) {
      for (const m of ch.meshes) {
        this.group.remove(m);
        m.dispose();
      }
    }
    this.chunks = [];
  }

  dispose(): void {
    this.clear();
    for (const [a, b] of this.geos) {
      a.dispose();
      b.dispose();
    }
    this.mat.dispose();
  }
}
