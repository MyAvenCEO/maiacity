/**
 * Polyline paths and ribbon geometry (roads, creeks, markings, curtains).
 * Allocation happens only when geometry is (re)built, never per frame.
 */
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from 'three';
import type { Vec2 } from '../../../../packages/geo/src/index.ts';

/** A densely sampled polyline with cumulative distance and left-pointing unit normals. */
export class Path {
  x: number[] = [];
  z: number[] = [];
  s: number[] = [];
  nx: number[] = [];
  nz: number[] = [];
  /** optional per-point payload interpolated by `sub` (e.g. design heights) */
  extra: number[][] = [];
  /** for a sub-path: where each point lies in the parent path, as a fractional index */
  at: number[] = [];

  get length(): number {
    return this.s.length ? this.s[this.s.length - 1]! : 0;
  }

  get count(): number {
    return this.x.length;
  }

  /**
   * Build from points, inserting samples so consecutive points are ≤ `step` apart.
   * `extra` (optional) holds per-input-point values (e.g. heights) that are interpolated.
   */
  static from(points: readonly Vec2[], step: number, extra?: readonly (readonly number[])[]): Path {
    const p = new Path();
    const nExtra = extra?.length ?? 0;
    for (let e = 0; e < nExtra; e += 1) p.extra.push([]);
    let s = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]!;
      if (i === 0) {
        p.push(a[0], a[1], 0);
        for (let e = 0; e < nExtra; e += 1) p.extra[e]!.push(extra![e]![0]!);
        continue;
      }
      const b = points[i - 1]!;
      const dx = a[0] - b[0];
      const dz = a[1] - b[1];
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 1; k <= n; k += 1) {
        const f = k / n;
        p.push(b[0] + dx * f, b[1] + dz * f, s + len * f);
        for (let e = 0; e < nExtra; e += 1) {
          const arr = extra![e]!;
          const va = arr[i - 1] ?? 0;
          const vb = arr[i] ?? va;
          p.extra[e]!.push(va + (vb - va) * f);
        }
      }
      s += len;
    }
    p.computeNormals();
    return p;
  }

  private push(x: number, z: number, s: number): void {
    this.x.push(x);
    this.z.push(z);
    this.s.push(s);
  }

  computeNormals(): void {
    const n = this.x.length;
    this.nx.length = n;
    this.nz.length = n;
    for (let i = 0; i < n; i += 1) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      let dx = this.x[i1]! - this.x[i0]!;
      let dz = this.z[i1]! - this.z[i0]!;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      // left of travel direction (x east, z south): (dz, −dx)
      this.nx[i] = dz;
      this.nz[i] = -dx;
    }
  }

  /** Sub-path between distances s0 and s1 (clamped), with interpolated end points. */
  sub(s0: number, s1: number): Path {
    const out = new Path();
    for (let e = 0; e < this.extra.length; e += 1) out.extra.push([]);
    const n = this.count;
    if (n < 2) return out;
    const a = Math.max(0, Math.min(s0, s1));
    const b = Math.min(this.length, Math.max(s0, s1));
    if (b - a < 1e-3) return out;
    const lerpAt = (sv: number) => {
      // binary search segment
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (this.s[mid]! <= sv) lo = mid;
        else hi = mid;
      }
      const sa = this.s[lo]!;
      const sb = this.s[hi]!;
      const f = sb > sa ? (sv - sa) / (sb - sa) : 0;
      out.x.push(this.x[lo]! + (this.x[hi]! - this.x[lo]!) * f);
      out.z.push(this.z[lo]! + (this.z[hi]! - this.z[lo]!) * f);
      out.s.push(sv);
      out.at.push(lo + f);
      out.nx.push(this.nx[lo]! + (this.nx[hi]! - this.nx[lo]!) * f);
      out.nz.push(this.nz[lo]! + (this.nz[hi]! - this.nz[lo]!) * f);
      for (let e = 0; e < this.extra.length; e += 1) {
        const arr = this.extra[e]!;
        out.extra[e]!.push(arr[lo]! + (arr[hi]! - arr[lo]!) * f);
      }
    };
    lerpAt(a);
    for (let i = 0; i < n; i += 1) {
      const sv = this.s[i]!;
      if (sv > a + 1e-4 && sv < b - 1e-4) {
        out.x.push(this.x[i]!);
        out.z.push(this.z[i]!);
        out.s.push(sv);
        out.at.push(i);
        out.nx.push(this.nx[i]!);
        out.nz.push(this.nz[i]!);
        for (let e = 0; e < this.extra.length; e += 1) out.extra[e]!.push(this.extra[e]![i]!);
      }
    }
    lerpAt(b);
    return out;
  }
}

/** y for a vertex at path point i, lateral offset o (+ = left), world position (x, z) */
export type YFn = (i: number, o: number, x: number, z: number) => number;

export class GeoBuilder {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  withColor = false;

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vertex(x: number, y: number, z: number, u = 0, v = 0, r = 1, g = 1, b = 1, a = 1): number {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    if (this.withColor) this.col.push(r, g, b, a);
    return this.pos.length / 3 - 1;
  }

  /**
   * Strip between lateral offsets o0 and o1 along the path, subdivided across so that no
   * cross step exceeds `maxAcross` metres (for draping).
   */
  strip(path: Path, o0: number | ((i: number) => number), o1: number | ((i: number) => number), y: YFn, maxAcross = 2, color?: [number, number, number, number] | ((i: number, f: number) => [number, number, number, number])): void {
    const n = path.count;
    if (n < 2) return;
    const off0 = typeof o0 === 'number' ? () => o0 : o0;
    const off1 = typeof o1 === 'number' ? () => o1 : o1;
    let across = 1;
    for (let i = 0; i < n; i += 1) across = Math.max(across, Math.ceil(Math.abs(off1(i) - off0(i)) / maxAcross));
    across = Math.min(across, 24);
    const base = this.vertexCount;
    for (let i = 0; i < n; i += 1) {
      const a = off0(i);
      const b = off1(i);
      for (let k = 0; k <= across; k += 1) {
        const f = k / across;
        const o = a + (b - a) * f;
        const x = path.x[i]! + path.nx[i]! * o;
        const z = path.z[i]! + path.nz[i]! * o;
        const c = color ? (typeof color === 'function' ? color(i, f) : color) : undefined;
        if (c) this.vertex(x, y(i, o, x, z), z, f, path.s[i]!, c[0], c[1], c[2], c[3]);
        else this.vertex(x, y(i, o, x, z), z, f, path.s[i]!);
      }
    }
    const row = across + 1;
    // orientation: offsets increase to the left; keep faces pointing up when o0 < o1
    const flip = off0(0) > off1(0);
    for (let i = 0; i < n - 1; i += 1) {
      for (let k = 0; k < across; k += 1) {
        const p00 = base + i * row + k;
        const p01 = p00 + 1;
        const p10 = p00 + row;
        const p11 = p10 + 1;
        if (!flip) this.idx.push(p00, p10, p01, p01, p10, p11);
        else this.idx.push(p00, p01, p10, p01, p11, p10);
      }
    }
  }

  /** Vertical curtain along offset `o` from yTop down to yBottom (faces outward on side `side`). */
  curtain(path: Path, o: number | ((i: number) => number), yTop: (i: number, x: number, z: number) => number, yBottom: (i: number, x: number, z: number) => number, side: 1 | -1, color?: [number, number, number, number]): void {
    const n = path.count;
    if (n < 2) return;
    const off = typeof o === 'number' ? () => o : o;
    const base = this.vertexCount;
    for (let i = 0; i < n; i += 1) {
      const oo = off(i);
      const x = path.x[i]! + path.nx[i]! * oo;
      const z = path.z[i]! + path.nz[i]! * oo;
      const t = yTop(i, x, z);
      const b = Math.min(t - 0.01, yBottom(i, x, z));
      const c = color ?? [1, 1, 1, 1];
      this.vertex(x, t, z, 0, path.s[i]!, c[0], c[1], c[2], c[3]);
      this.vertex(x, b, z, 1, path.s[i]!, c[0], c[1], c[2], c[3]);
    }
    for (let i = 0; i < n - 1; i += 1) {
      const t0 = base + i * 2;
      const b0 = t0 + 1;
      const t1 = t0 + 2;
      const b1 = t0 + 3;
      if (side > 0) this.idx.push(t0, t1, b0, t1, b1, b0);
      else this.idx.push(t0, b0, t1, t1, b0, b1);
    }
  }

  /** Dashed line of width w at offset o (dash/gap in metres; gap 0 = solid). */
  dashes(path: Path, o: number, w: number, dash: number, gap: number, y: YFn, color?: [number, number, number, number]): void {
    if (gap <= 0) {
      this.strip(path, o - w / 2, o + w / 2, y, 4, color);
      return;
    }
    const period = dash + gap;
    const L = path.length;
    for (let s = 0.5 * gap; s < L; s += period) {
      const sub = path.sub(s, Math.min(L, s + dash));
      if (sub.count < 2) continue;
      // `y` indexes `path`: evaluate it where each dash point lies in `path`
      const ySub: YFn = (i, oo, x, z) => {
        const t = sub.at[i]!;
        const k = Math.floor(t);
        const a = y(k, oo, x, z);
        return t > k ? a + (y(k + 1, oo, x, z) - a) * (t - k) : a;
      };
      this.strip(sub, o - w / 2, o + w / 2, ySub, 4, color);
    }
  }

  build(): BufferGeometry | null {
    if (this.idx.length === 0) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    if (this.withColor) g.setAttribute('color', new Float32BufferAttribute(this.col, 4));
    g.setIndex(new Uint32BufferAttribute(this.idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
