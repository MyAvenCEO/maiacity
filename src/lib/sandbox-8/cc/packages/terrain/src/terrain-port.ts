/**
 * TerrainPort implementation: the base terrain (pure, memoised) overlaid with edit tiles
 * from module state. Derived arrays are cached per state revision (keyed by the identity
 * of the `tiles` object, which changes exactly when edits change — robust against rolled-
 * back transactions reusing a revision number).
 */
import type { ReadCtx } from '../../kernel/src/index.ts';
import {
  polygonBounds as polygonBoundsOf,
  boundsContains,
  containsXZ,
  cumulativeLengths,
  nearestVertex,
  pointAtChainage,
  sampleBilinear,
  sampleGradient,
  type Vec2,
} from '../../geo/src/index.ts';
import type { GroundCell, ProfileSample, SoilColumn, SoilLayer, TerrainPort, TerrainState } from './contract.ts';
import { baseTerrain, creekNearest, creekValue, NO_CLASS, ROCK_LAYER_THICKNESS, type BaseTerrain } from './generate.ts';

/** Edit tiles are TILE × TILE vertices (32 × 4 m = 128 m at the default cell size). */
export const TILE = 32;

export const tileKey = (ti: number, tj: number): string => `${ti},${tj}`;

/** Current heights = base heights with every edited tile pasted over. */
export function applyTiles(base: BaseTerrain, tiles: Readonly<Record<string, readonly number[]>>): Float32Array {
  const h = base.heights.slice();
  const { nx, nz } = base.grid;
  for (const [key, values] of Object.entries(tiles)) {
    const [ti, tj] = key.split(',').map(Number) as [number, number];
    for (let lj = 0; lj < TILE; lj += 1) {
      const j = tj * TILE + lj;
      if (j >= nz) break;
      for (let li = 0; li < TILE; li += 1) {
        const i = ti * TILE + li;
        if (i >= nx) break;
        h[j * nx + i] = values[lj * TILE + li]!;
      }
    }
  }
  return h;
}

/** Soil column at base-grid vertex `idx`. */
export function soilColumnAt(base: BaseTerrain, idx: number): SoilColumn {
  const s = base.soil;
  const ids = s.roles.classIds;
  const td = s.topsoil[idx]!;
  const rd = s.rockDepth[idx]!;
  const layers: SoilLayer[] = [{ classId: ids[s.roles.topsoil]!, thickness: td }];
  const sub2 = s.sub2[idx]!;
  if (sub2 === NO_CLASS) {
    layers.push({ classId: ids[s.sub1[idx]!]!, thickness: rd - td });
  } else {
    const t1 = s.sub1Thick[idx]!;
    layers.push({ classId: ids[s.sub1[idx]!]!, thickness: t1 });
    layers.push({ classId: ids[sub2]!, thickness: rd - td - t1 });
  }
  layers.push({ classId: ids[s.roles.rock]!, thickness: ROCK_LAYER_THICKNESS });
  return { layers, rockDepth: rd };
}

/** the ground's own grid: cells of this size (m), so many to a height vertex's square (its strata: design/physical-state.md §5) */
export const GROUND_CELL = 1;

/** the ground's grid over a base terrain: its columns and rows, cells to a vertex side, and where a cell is */
export function groundGrid(base: BaseTerrain): { nx: number; nz: number; per: number; x(fi: number): number; z(fj: number): number; vertex(fi: number, fj: number): number } {
  const g = base.grid;
  const per = Math.max(1, Math.round(g.cell / GROUND_CELL));
  const size = g.cell / per;
  return {
    nx: g.nx * per,
    nz: g.nz * per,
    per,
    x: (fi) => g.x0 - g.cell / 2 + (fi + 0.5) * size,
    z: (fj) => g.z0 - g.cell / 2 + (fj + 0.5) * size,
    vertex: (fi, fj) => Math.min(g.nz - 1, Math.floor(fj / per)) * g.nx + Math.min(g.nx - 1, Math.floor(fi / per)),
  };
}

/** cells of the ground's grid to a side of a shard of the changed ground (a change copies only its shards) */
export const GROUND_SHARD = 32;
export type GroundRecord = Record<string, Record<string, GroundCell>>;
/** the shard a cell of the ground's grid (fj · columns + fi) is kept in */
export function shardOf(nx: number, key: number): string {
  return `${Math.floor((key % nx) / GROUND_SHARD)},${Math.floor(Math.floor(key / nx) / GROUND_SHARD)}`;
}
/** a changed cell of the ground, if it was changed */
export function groundCell(g: Readonly<GroundRecord> | undefined, nx: number, key: number): GroundCell | undefined {
  return g?.[shardOf(nx, key)]?.[key];
}
/** the changed ground being written: shards copied as they are first written to */
export class GroundWriter {
  readonly out: GroundRecord;
  private readonly copied = new Set<string>();
  constructor(
    base: Readonly<GroundRecord> | undefined,
    private readonly nx: number,
  ) {
    this.out = { ...(base ?? {}) };
  }
  get(key: number): GroundCell | undefined {
    return this.out[shardOf(this.nx, key)]?.[key];
  }
  set(key: number, cell: GroundCell): void {
    const s = shardOf(this.nx, key);
    if (!this.copied.has(s)) {
      this.out[s] = { ...(this.out[s] ?? {}) };
      this.copied.add(s);
    }
    this.out[s]![key] = cell;
  }
}

/** the column at a vertex as it is now: what was laid on it (the top first), then what is left of the original column */
export function columnAt(base: BaseTerrain, idx: number, cell: Readonly<GroundCell> | undefined): SoilColumn {
  const orig = soilColumnAt(base, idx);
  if (!cell) return orig;
  const layers: SoilLayer[] = cell.laid.filter((l) => l.t > 1e-9).map((l) => ({ classId: l.cls, thickness: l.t }));
  let off = cell.cut;
  for (const l of orig.layers) {
    const t = l.thickness - off;
    off = Math.max(0, off - l.thickness);
    if (t > 1e-9) layers.push({ classId: l.classId, thickness: t });
  }
  const laid = cell.laid.reduce((a, l) => a + l.t, 0);
  return { layers, rockDepth: Math.max(0, orig.rockDepth - cell.cut) + laid };
}

/** the grid vertices inside the pond's outline: its basin (memoised per base terrain) */
const basins = new WeakMap<BaseTerrain, number[]>();
export function basinOf(base: BaseTerrain): number[] {
  const hit = basins.get(base);
  if (hit) return hit;
  const out: number[] = [];
  const p = base.pond;
  if (p) {
    const g = base.grid;
    const i0 = Math.max(0, Math.floor((p.bounds.x0 - g.x0) / g.cell));
    const i1 = Math.min(g.nx - 1, Math.ceil((p.bounds.x1 - g.x0) / g.cell));
    const j0 = Math.max(0, Math.floor((p.bounds.z0 - g.z0) / g.cell));
    const j1 = Math.min(g.nz - 1, Math.ceil((p.bounds.z1 - g.z0) / g.cell));
    for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) if (containsXZ(p.outline, g.x0 + i * g.cell, g.z0 + j * g.cell)) out.push(j * g.nx + i);
  }
  basins.set(base, out);
  return out;
}

/** the water a basin holds up to a level (m³) */
export function basinVolume(base: BaseTerrain, heights: Float32Array, level: number): number {
  const a = base.grid.cell * base.grid.cell;
  let v = 0;
  for (const idx of basinOf(base)) v += Math.max(0, level - heights[idx]!) * a;
  return v;
}

/** the level a basin's water stands at (m a.s.l.) */
export function basinLevel(base: BaseTerrain, heights: Float32Array, volume: number): number {
  const idx = basinOf(base);
  if (!idx.length) return base.pond?.level ?? 0;
  let lo = Math.min(...idx.map((k) => heights[k]!));
  let hi = (base.pond?.rim ?? lo) + 10;
  if (volume <= 0) return lo;
  for (let it = 0; it < 48; it += 1) {
    const mid = (lo + hi) / 2;
    if (basinVolume(base, heights, mid) < volume) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface TerrainPortImpl extends TerrainPort {
  /** the memoised base terrain (package-internal: vegetation & tests) */
  base(): BaseTerrain;
}

export function createTerrainPort(ctx: ReadCtx): TerrainPortImpl {
  let base: BaseTerrain | undefined;
  const B = (): BaseTerrain => (base ??= baseTerrain(ctx.seed, ctx.data('terrainSettings'), ctx.data('soilClasses')));
  let cachedTiles: unknown;
  let cachedHeights: Float32Array | undefined;
  const state = (): Readonly<TerrainState> => ctx.state('terrain');
  const current = (): Float32Array => {
    const st = state();
    if (cachedHeights && cachedTiles === st.tiles) return cachedHeights;
    const b = B();
    // always a private copy: the base arrays are memoised and shared between runtimes
    cachedHeights = applyTiles(b, st.tiles);
    cachedTiles = st.tiles;
    return cachedHeights;
  };
  const heightAt = (x: number, z: number): number => sampleBilinear(B().grid, current(), x, z);
  // the ground's cell at a point, and its column now
  const fineAt = (x: number, z: number): [number, number] => {
    const fg = groundGrid(B());
    const size = B().grid.cell / fg.per;
    return [Math.max(0, Math.min(fg.nx - 1, Math.round((x - fg.x(0)) / size))), Math.max(0, Math.min(fg.nz - 1, Math.round((z - fg.z(0)) / size)))];
  };
  const columnOf = (fi: number, fj: number): SoilColumn => {
    const fg = groundGrid(B());
    return columnAt(B(), fg.vertex(fi, fj), groundCell(state().ground, fg.nx, fj * fg.nx + fi));
  };
  // the pond now: its water drawn or come back towards the water table since it was last changed, never above its rim
  let pondKey: [unknown, unknown, number] | undefined;
  let pondNow: { volume: number; level: number } | undefined;
  const pond = (): { volume: number; level: number } | undefined => {
    const b = B();
    if (!b.pond) return undefined;
    const h = current();
    const st = state().pond;
    if (pondKey && pondKey[0] === h && pondKey[1] === st && pondKey[2] === ctx.now) return pondNow;
    const table = basinVolume(b, h, b.pond.level);
    const full = basinVolume(b, h, b.pond.rim);
    const days = ctx.data('terrainSettings').pondRefill?.value;
    const was = st?.volume ?? table;
    const volume = Math.min(full, st && days ? table + (was - table) * Math.exp(-(ctx.now - st.at) / (days * 86400)) : was);
    pondNow = { volume, level: basinLevel(b, h, volume) };
    pondKey = [h, st, ctx.now];
    return pondNow;
  };

  const port: TerrainPortImpl = {
    get bounds() {
      return B().bounds;
    },
    get grid() {
      return B().grid;
    },
    base: B,
    heightAt,
    originalHeightAt: (x, z) => sampleBilinear(B().grid, B().heights, x, z),
    slopeAt(x, z) {
      const [dx, dz] = sampleGradient(B().grid, current(), x, z);
      return Math.hypot(dx, dz);
    },
    normalAt(x, z) {
      const [dx, dz] = sampleGradient(B().grid, current(), x, z);
      const l = Math.hypot(dx, 1, dz);
      return [-dx / l, 1 / l, -dz / l];
    },
    soilAt: (x, z) => columnOf(...fineAt(x, z)),
    soilClassAtDepth(x, z, depth) {
      // (below the surface as it is now: what was laid on it first, then what is left of the original column)
      const col = columnOf(...fineAt(x, z));
      let d = 0;
      for (const layer of col.layers) {
        d += layer.thickness;
        if (depth < d) return layer.classId;
      }
      return col.layers[col.layers.length - 1]!.classId;
    },
    soilMapColumn(x, z) {
      // (the map's unit: its column as the ground was, at the unit's middle)
      const cell = ctx.data('terrainSettings').soilMap?.cell.value ?? B().grid.cell;
      const [fi, fj] = fineAt((Math.floor(x / cell) + 0.5) * cell, (Math.floor(z / cell) + 0.5) * cell);
      return columnAt(B(), groundGrid(B()).vertex(fi, fj), undefined);
    },
    soilMapAt(x, z, depth) {
      const col = port.soilMapColumn(x, z);
      let d = 0;
      for (const layer of col.layers) {
        d += layer.thickness;
        if (depth < d) return layer.classId;
      }
      return col.layers[col.layers.length - 1]!.classId;
    },
    soilClass(id) {
      const c = ctx.data('soilClasses')[id];
      if (!c) throw new Error(`Unknown soil class ${id}`);
      return c;
    },
    get cellArea() {
      const s = B().grid.cell / groundGrid(B()).per;
      return s * s;
    },
    groundAt(fi, fj) {
      const fg = groundGrid(B());
      const x = fg.x(fi);
      const z = fg.z(fj);
      const c = groundCell(state().ground, fg.nx, fj * fg.nx + fi);
      // (the base surface there, and what was dug and laid since: the height vertices carry their cells' mean)
      const h = sampleBilinear(B().grid, B().heights, x, z) + (c ? c.laid.reduce((a, l) => a + l.t, 0) - c.cut : 0);
      return { x, z, h, column: columnAt(B(), fg.vertex(fi, fj), c) };
    },
    cover(polygon) {
      const fg = groundGrid(B());
      const size = B().grid.cell / fg.per;
      const b = polygonBoundsOf(polygon);
      const [fi0, fj0] = fineAt(b.x0, b.z0);
      const [fi1, fj1] = fineAt(b.x1, b.z1);
      const out: [number, number, number][] = [];
      for (let fj = fj0; fj <= fj1; fj += 1) for (let fi = fi0; fi <= fi1; fi += 1) if (containsXZ(polygon, fg.x(fi), fg.z(fj))) out.push([fi, fj, size * size]);
      return out;
    },
    pondVolume: () => pond()?.volume,
    pondLevel: () => pond()?.level,
    waterDepthAt(x, z) {
      const b = B();
      let depth = 0;
      // (the ground's own surface there, not the height mesh's mean: a bank stripped beside the channel does not
      // deepen the creek)
      const heightAt = (px: number, pz: number): number => {
        const [fi, fj] = fineAt(px, pz);
        const nx = groundGrid(b).nx;
        const c = groundCell(state().ground, nx, fj * nx + fi);
        return sampleBilinear(b.grid, b.heights, px, pz) + (c ? c.laid.reduce((a, l) => a + l.t, 0) - c.cut : 0);
      };
      if (b.creek) {
        const hit = creekNearest(b.creek, x, z, b.creek.maxHalfWidth);
        if (hit && hit.d <= creekValue(b.creek.widths, hit.seg, hit.t) / 2) depth = Math.max(0, creekValue(b.creek.levels, hit.seg, hit.t) - heightAt(x, z));
      }
      if (b.pond && boundsContains(b.pond.bounds, x, z) && containsXZ(b.pond.outline, x, z)) depth = Math.max(depth, pond()!.level - heightAt(x, z));
      return depth;
    },
    // (the pond at its level now)
    waterBodies: () => B().water.map((w) => (w.kind === 'pond' && pond() ? { ...w, levels: [pond()!.level] } : w)),
    profile(points, spacing) {
      if (!(spacing > 0)) throw new Error('profile: spacing must be > 0');
      const out: ProfileSample[] = [];
      if (points.length === 0) return out;
      const cum = cumulativeLengths(points);
      const total = cum[cum.length - 1]!;
      const steps: number[] = [];
      for (let s = 0; s < total - 1e-9; s += spacing) steps.push(s);
      steps.push(total);
      for (const s of steps) {
        const [x, z] = pointAtChainage(points as Vec2[], s, cum);
        out.push({ s, x, z, h: heightAt(x, z), h0: port.originalHeightAt(x, z), water: port.waterDepthAt(x, z) });
      }
      return out;
    },
    heights: current,
    revision: () => state().revision,
  };
  return port;
}
