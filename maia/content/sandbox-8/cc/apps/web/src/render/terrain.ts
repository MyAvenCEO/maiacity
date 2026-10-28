/**
 * Terrain block: indexed heightfield mesh with vertex colours (soil/landcover from the worker,
 * plus gentle variation, curvature shading and a soft static hillshade), a fine detail texture,
 * an earthen plinth around the map edge, and an optional data overlay draped on top.
 */
import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Uint32BufferAttribute,
  UnsignedByteType,
} from 'three';
import type { GridSpec } from '../../../../packages/geo/src/index.ts';
import type { OverlayData } from './api.ts';
import { hash2, overlayRgba, PALETTE } from './colors.ts';
import type { Heightfield } from './heightfield.ts';

const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const LUT = new Float32Array(256).map((_, i) => srgbToLinear(i));

/** smooth value noise in 0..1 */
function vnoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

let sharedDetail: DataTexture | null = null;
/** shared tileable grain texture (mean ≈ 0.84 in sRGB) */
export function detailTexture(): DataTexture {
  if (sharedDetail) return sharedDetail;
  sharedDetail = makeDetailTexture();
  return sharedDetail;
}

/**
 * Multiply a material's colour by the grain texture sampled in world xz (metres / `scale`),
 * fading out with distance. Uses `map`, so the material must not have its own map.
 */
export function addDetail(mat: MeshStandardMaterial, scale: number, strength: number, fadeDist = 900): void {
  mat.map = detailTexture();
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = (modelMatrix * vec4(position, 1.0)).xz / ${scale.toFixed(2)};\n#endif`);
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        float dfade = clamp(vViewPosition.z / ${fadeDist.toFixed(1)}, 0.0, 1.0);
        vec3 grain = mix(vec3(1.0), sampledDiffuseColor.rgb * 1.19, ${strength.toFixed(2)});
        diffuseColor.rgb *= mix(grain, vec3(1.0), dfade * 0.75);
      #endif`,
    );
  };
  mat.customProgramCacheKey = () => `detail-${scale}-${strength}-${fadeDist}`;
}

function makeDetailTexture(): DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      // tileable: sample noise on a torus-ish by wrapping lattice coordinates
      const f = (x: number, z: number, p: number) => {
        const xi = Math.floor(x);
        const zi = Math.floor(z);
        const xf = x - xi;
        const zf = z - zi;
        const u = xf * xf * (3 - 2 * xf);
        const v = zf * zf * (3 - 2 * zf);
        const w = (a: number) => ((a % p) + p) % p;
        const a = hash2(w(xi), w(zi));
        const b = hash2(w(xi + 1), w(zi));
        const c = hash2(w(xi), w(zi + 1));
        const d = hash2(w(xi + 1), w(zi + 1));
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
      };
      const x = i / N;
      const z = j / N;
      const n = f(x * 8, z * 8, 8) * 0.45 + f(x * 32, z * 32, 32) * 0.35 + f(x * 64, z * 64, 64) * 0.2;
      const g = 214 + (n - 0.5) * 60 + (hash2(i, j) - 0.5) * 22;
      const k = (j * N + i) * 4;
      data[k] = g;
      data[k + 1] = g;
      data[k + 2] = g;
      data[k + 3] = 255;
    }
  }
  const t = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export class TerrainLayer {
  readonly group = new Group();
  mesh: Mesh | null = null;
  private geo: BufferGeometry | null = null;
  private mat: MeshStandardMaterial;
  private plinth: Mesh | null = null;
  private plinthMat: MeshStandardMaterial;
  private overlayMesh: Mesh | null = null;
  private overlayMat: MeshBasicMaterial;
  private overlayTex: DataTexture | null = null;
  private grid: GridSpec | null = null;
  private colors: Uint8Array | null = null;
  private heightsCopy: Float32Array | null = null;
  plinthBottom = -30;

  constructor(private hf: () => Heightfield) {
    this.mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    addDetail(this.mat, 22, 0.85);
    this.plinthMat = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: DoubleSide });
    this.overlayMat = new MeshBasicMaterial({ transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false, toneMapped: false });
    this.group.name = 'terrain';
  }

  setWorld(grid: GridSpec, heights: Float32Array, colors: Uint8Array): void {
    this.disposeMeshes();
    this.grid = grid;
    this.colors = colors;
    const { nx, nz, x0, z0, cell } = grid;
    const n = nx * nz;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const k = j * nx + i;
        pos[k * 3] = x0 + i * cell;
        pos[k * 3 + 2] = z0 + j * cell;
        uv[k * 2] = i / (nx - 1);
        uv[k * 2 + 1] = j / (nz - 1);
      }
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j += 1) {
      for (let i = 0; i < nx - 1; i += 1) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        idx[p++] = a;
        idx[p++] = c;
        idx[p++] = b;
        idx[p++] = b;
        idx[p++] = c;
        idx[p++] = d;
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(nor, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setIndex(new Uint32BufferAttribute(idx, 1));
    this.geo = g;
    this.heightsCopy = new Float32Array(heights);
    this.writeRange(0, nx - 1, 0, nz - 1, heights, colors);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const mesh = new Mesh(g, this.mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'terrain';
    this.mesh = mesh;
    this.group.add(mesh);
    this.buildPlinth();
  }

  /** heights (and colours) changed: patch only the touched rectangle */
  patch(heights: Float32Array, colors?: Uint8Array): void {
    const g = this.grid;
    const geo = this.geo;
    if (!g || !geo || !this.heightsCopy) return;
    const { nx, nz } = g;
    let i0 = nx;
    let i1 = -1;
    let j0 = nz;
    let j1 = -1;
    const old = this.heightsCopy;
    const oc = this.colors;
    for (let k = 0; k < heights.length; k += 1) {
      let changed = heights[k] !== old[k];
      if (!changed && colors && oc) changed = colors[k * 3] !== oc[k * 3] || colors[k * 3 + 1] !== oc[k * 3 + 1] || colors[k * 3 + 2] !== oc[k * 3 + 2];
      if (changed) {
        const j = (k / nx) | 0;
        const i = k - j * nx;
        if (i < i0) i0 = i;
        if (i > i1) i1 = i;
        if (j < j0) j0 = j;
        if (j > j1) j1 = j;
      }
    }
    if (colors) this.colors = colors;
    if (i1 < 0) return;
    old.set(heights);
    // normals and curvature shading depend on neighbours
    i0 = Math.max(0, i0 - 2);
    j0 = Math.max(0, j0 - 2);
    i1 = Math.min(nx - 1, i1 + 2);
    j1 = Math.min(nz - 1, j1 + 2);
    this.writeRange(i0, i1, j0, j1, heights, this.colors!);
    const start = j0 * nx;
    const count = (j1 - j0 + 1) * nx;
    for (const name of ['position', 'normal', 'color']) {
      const attr = geo.getAttribute(name) as BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(start * 3, count * 3);
      attr.needsUpdate = true;
    }
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    if (i0 === 0 || j0 === 0 || i1 === nx - 1 || j1 === nz - 1) this.buildPlinth();
  }

  private writeRange(i0: number, i1: number, j0: number, j1: number, heights: Float32Array, colors: Uint8Array): void {
    const g = this.grid!;
    const geo = this.geo!;
    const base = this.hf().baseY;
    const { nx, nz, cell, x0, z0 } = g;
    const pos = (geo.getAttribute('position') as BufferAttribute).array as Float32Array;
    const nor = (geo.getAttribute('normal') as BufferAttribute).array as Float32Array;
    const col = (geo.getAttribute('color') as BufferAttribute).array as Float32Array;
    const H = (i: number, j: number) => heights[(j < 0 ? 0 : j >= nz ? nz - 1 : j) * nx + (i < 0 ? 0 : i >= nx ? nx - 1 : i)]!;
    // static hillshade light from the north-west (cartographic convention), soft
    const lx = -0.5;
    const ly = 0.75;
    const lz = -0.45;
    const ll = Math.hypot(lx, ly, lz);
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const k = j * nx + i;
        const h = heights[k]!;
        pos[k * 3 + 1] = h - base;
        const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * cell);
        const dz = (H(i, j + 1) - H(i, j - 1)) / (2 * cell);
        const inv = 1 / Math.hypot(dx, 1, dz);
        const nxv = -dx * inv;
        const nyv = inv;
        const nzv = -dz * inv;
        nor[k * 3] = nxv;
        nor[k * 3 + 1] = nyv;
        nor[k * 3 + 2] = nzv;
        // curvature (Laplacian over a 2-cell radius): hollows darker, ridges lighter
        const lap = (H(i - 2, j) + H(i + 2, j) + H(i, j - 2) + H(i, j + 2) - 4 * h) / (4 * cell * cell);
        const curv = Math.max(-0.12, Math.min(0.12, -lap * 9));
        const shade = Math.max(0, (nxv * lx + nyv * ly + nzv * lz) / ll);
        const hill = 0.72 + 0.4 * shade;
        const x = x0 + i * cell;
        const z = z0 + j * cell;
        const n1 = vnoise(x / 60, z / 60);
        const n2 = vnoise(x / 13 + 31.7, z / 13 + 11.3);
        const vari = 0.93 + n1 * 0.1 + (n2 - 0.5) * 0.06;
        const f = hill * (1 + curv) * vari;
        let r = LUT[colors[k * 3]!]!;
        let gg = LUT[colors[k * 3 + 1]!]!;
        let b = LUT[colors[k * 3 + 2]!]!;
        // vegetated ground: tone down saturation and break it into meadow / pasture patches
        if (gg > r * 1.05 && gg > b) {
          const n3 = vnoise(x / 170 + 7.1, z / 170 - 3.3);
          const n4 = vnoise(x / 45 - 2.7, z / 45 + 9.1);
          const lum = 0.3 * r + 0.59 * gg + 0.11 * b;
          const sat = 0.78;
          r = lum + (r - lum) * sat;
          gg = lum + (gg - lum) * sat;
          b = lum + (b - lum) * sat;
          // dry / ochre patches and lusher hollows
          const dry = Math.max(0, n3 - 0.45) * 1.1 + Math.max(0, n4 - 0.6) * 0.5;
          r += (0.115 - r) * dry * 0.55;
          gg += (0.105 - gg) * dry * 0.35;
          b += (0.045 - b) * dry * 0.4;
          const lush = Math.max(0, 0.4 - n3) * 0.6;
          r *= 1 - lush * 0.25;
          b *= 1 - lush * 0.1;
        } else {
          const hue = (n1 - 0.5) * 0.08;
          r *= 1 + hue;
          b *= 1 - hue;
        }
        col[k * 3] = r * f;
        col[k * 3 + 1] = gg * f;
        col[k * 3 + 2] = b * f;
        void x;
        void z;
      }
    }
  }

  private buildPlinth(): void {
    const g = this.grid;
    if (!g || !this.heightsCopy) return;
    if (this.plinth) {
      this.group.remove(this.plinth);
      this.plinth.geometry.dispose();
      this.plinth = null;
    }
    const hf = this.hf();
    const heights = this.heightsCopy;
    const base = hf.baseY;
    const bottom = hf.minY - 28;
    this.plinthBottom = bottom;
    const { nx, nz, x0, z0, cell } = g;
    // walk the border counter-clockwise (seen from above): north edge W→E… build as rings of vertices
    const border: [number, number][] = [];
    for (let i = 0; i < nx; i += 1) border.push([i, 0]);
    for (let j = 1; j < nz; j += 1) border.push([nx - 1, j]);
    for (let i = nx - 2; i >= 0; i -= 1) border.push([i, nz - 1]);
    for (let j = nz - 2; j >= 1; j -= 1) border.push([0, j]);
    border.push([0, 0]);
    // depth bands: topsoil, subsoil, weathered rock, rock to the bottom
    const bands: [number, string][] = [
      [0, PALETTE.plinthTop],
      [-0.6, PALETTE.plinthTop],
      [-1.4, PALETTE.plinthMid],
      [-5.5, PALETTE.plinthMid],
      [-7, PALETTE.plinthRock],
      [-1e9, '#4a3a30'],
    ];
    const pos: number[] = [];
    const colArr: number[] = [];
    const idx: number[] = [];
    const c = new Color();
    const rows = bands.length;
    for (let b = 0; b < border.length; b += 1) {
      const [i, j] = border[b]!;
      const top = heights[j * nx + i]! - base;
      const x = x0 + i * cell;
      const z = z0 + j * cell;
      for (let r = 0; r < rows; r += 1) {
        const [d, hex] = bands[r]!;
        const y = r === rows - 1 ? bottom : Math.max(bottom + 0.5, top + d);
        pos.push(x, y, z);
        c.set(hex);
        const shade = 0.75 + 0.25 * vnoise(x / 9, y / 3);
        colArr.push(c.r * shade, c.g * shade, c.b * shade);
      }
    }
    for (let b = 0; b < border.length - 1; b += 1) {
      for (let r = 0; r < rows - 1; r += 1) {
        const a0 = b * rows + r;
        const a1 = a0 + 1;
        const b0 = (b + 1) * rows + r;
        const b1 = b0 + 1;
        idx.push(a0, a1, b0, b0, a1, b1);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new Float32BufferAttribute(colArr, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // flat outward normals read better on a block
    const nor = geo.getAttribute('normal') as BufferAttribute;
    for (let b = 0; b < border.length; b += 1) {
      const [i, j] = border[b]!;
      let ox = 0;
      let oz = 0;
      if (j === 0) oz = -1;
      else if (j === nz - 1) oz = 1;
      if (i === 0) ox = -1;
      else if (i === nx - 1) ox = 1;
      const l = Math.hypot(ox, oz) || 1;
      for (let r = 0; r < rows; r += 1) nor.setXYZ(b * rows + r, ox / l, 0, oz / l);
    }
    this.plinth = new Mesh(geo, this.plinthMat);
    this.plinth.name = 'plinth';
    this.plinth.receiveShadow = true;
    this.group.add(this.plinth);
  }

  setOverlay(data: OverlayData | null): void {
    if (this.overlayTex) {
      this.overlayTex.dispose();
      this.overlayTex = null;
    }
    if (!data || !this.geo || !this.grid) {
      if (this.overlayMesh) this.overlayMesh.visible = false;
      return;
    }
    const { nx, nz, values, min, max, layer } = data;
    const buf = new Uint8Array(nx * nz * 4);
    const rgba: [number, number, number, number] = [0, 0, 0, 0];
    for (let k = 0; k < nx * nz; k += 1) {
      overlayRgba(layer, values[k]!, min, max, rgba);
      buf[k * 4] = rgba[0];
      buf[k * 4 + 1] = rgba[1];
      buf[k * 4 + 2] = rgba[2];
      buf[k * 4 + 3] = rgba[3];
    }
    const tex = new DataTexture(buf, nx, nz, RGBAFormat, UnsignedByteType);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
    const categorical = layer === 'soil';
    tex.magFilter = categorical ? NearestFilter : LinearFilter;
    tex.minFilter = categorical ? NearestFilter : LinearFilter;
    tex.generateMipmaps = false;
    // terrain uv (0..1 over the terrain grid) → overlay texel space
    const g = this.grid;
    const tW = (g.nx - 1) * g.cell;
    const tD = (g.nz - 1) * g.cell;
    tex.repeat.set(tW / (data.cell * nx), tD / (data.cell * nz));
    tex.offset.set((g.x0 - data.x0) / (data.cell * nx) + 0.5 / nx, (g.z0 - data.z0) / (data.cell * nz) + 0.5 / nz);
    tex.flipY = false;
    tex.needsUpdate = true;
    this.overlayTex = tex;
    this.overlayMat.map = tex;
    this.overlayMat.needsUpdate = true;
    if (!this.overlayMesh) {
      this.overlayMesh = new Mesh(this.geo, this.overlayMat);
      this.overlayMesh.name = 'overlay';
      this.overlayMesh.renderOrder = 2;
      this.group.add(this.overlayMesh);
    }
    this.overlayMesh.geometry = this.geo;
    this.overlayMesh.visible = true;
  }

  private disposeMeshes(): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh = null;
    }
    if (this.overlayMesh) {
      this.group.remove(this.overlayMesh);
      this.overlayMesh = null;
    }
    this.geo?.dispose();
    this.geo = null;
    if (this.plinth) {
      this.group.remove(this.plinth);
      this.plinth.geometry.dispose();
      this.plinth = null;
    }
  }

  dispose(): void {
    this.disposeMeshes();
    this.mat.map?.dispose();
    this.mat.dispose();
    this.plinthMat.dispose();
    this.overlayMat.dispose();
    this.overlayTex?.dispose();
  }
}
