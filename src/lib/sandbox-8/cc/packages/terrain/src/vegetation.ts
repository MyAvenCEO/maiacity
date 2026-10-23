/**
 * Vegetation: trees derived from (seed, terrainSettings, treeSpecies, base terrain).
 *
 * Patterns follow the central German cultural landscape:
 *  - woodland on steep slopes and hilltops (land too steep or poor for the plough), meadows
 *    on the wet valley floor, arable/grass on the loess plateaus; woodland share = forestCover
 *  - stands are species-pure or mixed: conifer plantations (spruce/pine) beside broadleaf
 *    stands (beech/oak). Bundeswaldinventur 2012: ~54 % of German forest area is conifer;
 *    hill country woodland on loess is more broadleaved, so the default share is ~45 %.
 *  - outside woodland: riparian trees along the creek (alder/willow galleries), hedgerows
 *    along contour lines (Feldhecken on terrace risers) and solitary field trees.
 *
 * Stocking: mature high forest carries roughly 250–400 trees/ha (≥ 7 cm dbh); we use one
 * tree per 5.8 m jitter cell (~300/ha) minus clearings.
 * Allometry (rule of thumb, Central European species): dbh ≈ 0.0095·h^1.2 m in closed stands
 * (beech 30 m → 0.56 m), open-grown trees ~35 % thicker with ~50 % wider crowns.
 *
 * Only the BASE terrain is used (original heights and water), so vegetation never changes
 * when the terrain is edited — removals are explicit commands.
 */
import { hash32, hashNoise, type ReadCtx } from '../../kernel/src/index.ts';
import {
  boundsContains,
  clamp01,
  containsXZ,
  fbm2,
  pointSegment,
  polygonBounds,
  SpatialHash,
  segmentHash,
  smoothstep,
  type Vec2,
} from '../../geo/src/index.ts';
import type { TerrainPort, TerrainSettings, Tree, TreeSpecies, VegetationPort, VegetationState, WaterBody } from './contract.ts';
import { outlineDistance } from './generate.ts';

export interface BaseVegetation {
  trees: readonly Tree[];
  byId: ReadonlyMap<string, Tree>;
  index: SpatialHash<Tree>;
  /** woodland share actually achieved on the mask grid */
  forestShare: number;
}

const WOOD_SPACING = 5.8; // m → ≈ 300 stems/ha
const CONIFER_SHARE_MID = 0.5; // stand-noise threshold → ≈ 45 % conifer stands
const MASK_CELL = 8;

interface WaterTest {
  /** true if (x, z) is in water or within `margin` of it */
  near(x: number, z: number, margin: number): boolean;
  /** distance to the creek centreline (capped) */
  creekDistance(x: number, z: number, cap: number): number;
  creeks: WaterBody[];
}

function waterTest(bodies: readonly WaterBody[]): WaterTest {
  const creeks = bodies.filter((b) => b.kind === 'creek' && b.points.length >= 2);
  const ponds = bodies.filter((b) => b.kind === 'pond' && b.points.length >= 3).map((b) => ({ poly: b.points, bounds: polygonBounds(b.points) }));
  const hashes = creeks.map((c) => ({ c, h: segmentHash(c.points, 24), maxW: Math.max(...(c.widths ?? [3])) }));
  const nearestCreek = (x: number, z: number, cap: number): { d: number; hw: number } => {
    let best = { d: cap, hw: 0 };
    for (const { c, h } of hashes) {
      for (const k of h.queryRadius(x, z, cap)) {
        const r = pointSegment([x, z], c.points[k]!, c.points[k + 1]!);
        if (r.d < best.d) {
          const w = c.widths ? c.widths[k]! + (c.widths[k + 1]! - c.widths[k]!) * r.t : 3;
          best = { d: r.d, hw: w / 2 };
        }
      }
    }
    return best;
  };
  return {
    creeks,
    near(x, z, margin) {
      for (const { maxW } of hashes) {
        const n = nearestCreek(x, z, maxW / 2 + margin + 1);
        if (n.hw > 0 && n.d <= n.hw + margin) return true;
      }
      for (const p of ponds) {
        if (x < p.bounds.x0 - margin || x > p.bounds.x1 + margin || z < p.bounds.z0 - margin || z > p.bounds.z1 + margin) continue;
        if (containsXZ(p.poly, x, z) || outlineDistance(p.poly, x, z) <= margin) return true;
      }
      return false;
    },
    creekDistance: (x, z, cap) => nearestCreek(x, z, cap).d,
  };
}

const r2 = (v: number, k = 100): number => Math.round(v * k) / k;

export function generateVegetation(seed: number, settings: TerrainSettings, species: Record<string, TreeSpecies>, terrain: TerrainPort): BaseVegetation {
  const seedV = (hash32('vegetation') ^ Math.imul(seed >>> 0, 0x85ebca6b)) >>> 0;
  const S = (k: number): number => (seedV + Math.imul(k, 0x632be5ab)) >>> 0;
  const rnd = (k: number, ...c: number[]): number => hashNoise(S(k), ...c);
  const b = terrain.bounds;
  const water = waterTest(terrain.waterBodies());
  const ids = Object.keys(species).sort();
  const broadleaf = ids.filter((id) => species[id]!.kind === 'broadleaf');
  const conifer = ids.filter((id) => species[id]!.kind === 'conifer');
  const trees: Tree[] = [];
  const h0 = (x: number, z: number) => terrain.originalHeightAt(x, z);
  let hMin = Infinity;
  let hMax = -Infinity;

  // ------------------------------------------------------------ woodland mask (8 m grid)
  const mnx = Math.floor((b.x1 - b.x0) / MASK_CELL) + 1;
  const mnz = Math.floor((b.z1 - b.z0) / MASK_CELL) + 1;
  const mask = new Float32Array(mnx * mnz);
  const hs = new Float32Array(mnx * mnz);
  for (let j = 0; j < mnz; j += 1) {
    for (let i = 0; i < mnx; i += 1) {
      const h = h0(b.x0 + i * MASK_CELL, b.z0 + j * MASK_CELL);
      hs[j * mnx + i] = h;
      hMin = Math.min(hMin, h);
      hMax = Math.max(hMax, h);
    }
  }
  const relief = Math.max(1, hMax - hMin);
  const EXCLUDED = -10;
  for (let j = 0; j < mnz; j += 1) {
    for (let i = 0; i < mnx; i += 1) {
      const x = b.x0 + i * MASK_CELL;
      const z = b.z0 + j * MASK_CELL;
      const k = j * mnx + i;
      const hx = (hs[j * mnx + Math.min(i + 1, mnx - 1)]! - hs[j * mnx + Math.max(i - 1, 0)]!) / (MASK_CELL * (i > 0 && i < mnx - 1 ? 2 : 1));
      const hz = (hs[Math.min(j + 1, mnz - 1) * mnx + i]! - hs[Math.max(j - 1, 0) * mnx + i]!) / (MASK_CELL * (j > 0 && j < mnz - 1 ? 2 : 1));
      const slope = Math.hypot(hx, hz);
      if (water.near(x, z, 3)) {
        mask[k] = EXCLUDED;
        continue;
      }
      const dCreek = water.creeks.length ? water.creekDistance(x, z, 90) : 90;
      mask[k] =
        fbm2(S(1), x / 420, z / 420, { octaves: 5, gain: 0.55 }) + // patches with irregular edges
        0.9 * smoothstep(0.08, 0.25, slope) + // too steep to plough (> ~15 %) → wood
        0.35 * ((hs[k]! - hMin) / relief) - // crests wooded
        0.8 * (1 - smoothstep(15, 70, dCreek)); // wet valley meadows stay open
    }
  }
  const sorted = Array.from(mask).sort((p, q) => q - p);
  const cover = clamp01(settings.forestCover);
  const nWood = Math.floor(cover * sorted.length);
  const thr = nWood <= 0 ? Infinity : Math.max(sorted[Math.min(nWood, sorted.length) - 1]!, EXCLUDED + 1);
  let woodCells = 0;
  for (const v of mask) if (v >= thr) woodCells += 1;
  const maskAt = (x: number, z: number): number => {
    const fx = Math.min(Math.max((x - b.x0) / MASK_CELL, 0), mnx - 1);
    const fz = Math.min(Math.max((z - b.z0) / MASK_CELL, 0), mnz - 1);
    const i = Math.min(Math.floor(fx), mnx - 2);
    const j = Math.min(Math.floor(fz), mnz - 2);
    const tx = fx - i;
    const tz = fz - j;
    const k = j * mnx + i;
    return mask[k]! * (1 - tx) * (1 - tz) + mask[k + 1]! * tx * (1 - tz) + mask[k + mnx]! * (1 - tx) * tz + mask[k + mnx + 1]! * tx * tz;
  };
  const inWood = (x: number, z: number): boolean => maskAt(x, z) >= thr;

  const pickSpecies = (kind: 'broadleaf' | 'conifer', x: number, z: number, k: number): string | undefined => {
    const list = kind === 'conifer' ? (conifer.length ? conifer : broadleaf) : broadleaf.length ? broadleaf : conifer;
    if (!list.length) return undefined;
    // stands of ~150 m share a lead species; 30 % of stems are admixed
    const lead = list[Math.floor(rnd(4, Math.floor(x / 150), Math.floor(z / 150), kind === 'conifer' ? 1 : 0) * list.length)]!;
    return rnd(5, k) < 0.3 ? list[Math.floor(rnd(6, k) * list.length)]! : lead;
  };
  const makeTree = (x: number, z: number, sp: string, height: number, open: boolean, setting: Tree['setting'], k: number): void => {
    const conif = species[sp]!.kind === 'conifer';
    const dbh = 0.0095 * height ** 1.2 * (conif ? 0.9 : 1) * (0.85 + 0.3 * rnd(7, k)) * (open ? 1.35 : 1);
    const crown = (conif ? 0.08 : 0.14) * height * (open ? 1.5 : 1);
    trees.push(Object.freeze({ id: `t${trees.length}`, x: r2(x), z: r2(z), species: sp, height: r2(height, 10), dbh: r2(dbh), crownRadius: r2(crown, 10), setting }));
  };
  const inside = (x: number, z: number) => boundsContains(b, x, z);

  // ------------------------------------------------------------ woodland stands
  if (woodCells > 0) {
    const ni = Math.ceil((b.x1 - b.x0) / WOOD_SPACING);
    const nj = Math.ceil((b.z1 - b.z0) / WOOD_SPACING);
    for (let cj = 0; cj < nj; cj += 1) {
      for (let ci = 0; ci < ni; ci += 1) {
        const x = b.x0 + (ci + 0.1 + 0.8 * rnd(10, ci, cj, 0)) * WOOD_SPACING;
        const z = b.z0 + (cj + 0.1 + 0.8 * rnd(10, ci, cj, 1)) * WOOD_SPACING;
        if (!inside(x, z) || !inWood(x, z)) continue;
        if (rnd(10, ci, cj, 2) < 0.06) continue; // gaps, rides, windthrow
        if (water.near(x, z, 1)) continue;
        const k = cj * ni + ci;
        const stand = 0.5 + 0.5 * fbm2(S(2), x / 300, z / 300, { octaves: 3 });
        const wet = water.creeks.length > 0 && water.creekDistance(x, z, 40) < 40;
        const pConifer = wet ? 0 : 0.05 + 0.9 * smoothstep(CONIFER_SHARE_MID - 0.1, CONIFER_SHARE_MID + 0.1, stand);
        const sp = pickSpecies(rnd(10, ci, cj, 3) < pConifer ? 'conifer' : 'broadleaf', x, z, k);
        if (!sp) continue;
        const maturity = 0.45 + 0.55 * (0.5 + 0.5 * fbm2(S(3), x / 250, z / 250, { octaves: 2 }));
        const height = Math.max(4, species[sp]!.matureHeight.value * maturity * (0.85 + 0.25 * rnd(10, ci, cj, 4)));
        makeTree(x, z, sp, height, false, 'woodland', k);
      }
    }
  }

  // ------------------------------------------------------------ trees in the open landscape
  const areaHa = ((b.x1 - b.x0) * (b.z1 - b.z0)) / 10_000;
  const forestShare = woodCells / mask.length;
  const openHa = areaHa * (1 - forestShare);
  const budget = Math.round(settings.scatteredTreesPerHa.value * openHa);
  const hasCreek = water.creeks.length > 0;
  const riparianBudget = hasCreek ? Math.round(budget * 0.3) : 0;
  const hedgeBudget = Math.round(budget * (hasCreek ? 0.4 : 0.6));
  const openOk = (x: number, z: number): boolean => inside(x, z) && !inWood(x, z) && !water.near(x, z, 1);
  const openTree = (x: number, z: number, setting: Tree['setting'], k: number, coniferChance: number): void => {
    const sp = pickSpecies(rnd(20, k) < coniferChance ? 'conifer' : 'broadleaf', x, z, k + 1_000_000);
    if (!sp) return;
    makeTree(x, z, sp, species[sp]!.matureHeight.value * (0.55 + 0.45 * rnd(21, k)), true, setting, k + 1_000_000);
  };
  let serial = 0;

  // riparian gallery: alternating banks, 1.5–4.5 m beyond the water's edge
  let placed = 0;
  for (const c of water.creeks) {
    let s = 0;
    for (let k = 0; k < c.points.length - 1 && placed < riparianBudget; k += 1) {
      const a = c.points[k]!;
      const q = c.points[k + 1]!;
      const segLen = Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (segLen <= 0) continue;
      const nrm: Vec2 = [(q[1] - a[1]) / segLen, -(q[0] - a[0]) / segLen];
      for (; s < segLen && placed < riparianBudget; s += 9) {
        serial += 1;
        if (rnd(30, serial) < 0.35) continue; // gaps in the gallery
        const hw = (c.widths ? c.widths[k]! : 3) / 2;
        const side = rnd(31, serial) < 0.5 ? 1 : -1;
        const off = side * (hw + 1.5 + 3 * rnd(32, serial));
        const t = s / segLen;
        const x = a[0] + (q[0] - a[0]) * t + nrm[0] * off;
        const z = a[1] + (q[1] - a[1]) * t + nrm[1] * off;
        if (!openOk(x, z)) continue;
        openTree(x, z, 'riparian', serial, 0);
        placed += 1;
      }
      s -= segLen;
    }
  }

  // hedgerows: follow the contour (terrace risers) with gentle wander, 8–11 m spacing
  placed = 0;
  for (let hedge = 0; hedge < 400 && placed < hedgeBudget; hedge += 1) {
    let x = 0;
    let z = 0;
    let found = false;
    for (let attempt = 0; attempt < 30 && !found; attempt += 1) {
      x = b.x0 + rnd(40, hedge, attempt, 0) * (b.x1 - b.x0);
      z = b.z0 + rnd(40, hedge, attempt, 1) * (b.z1 - b.z0);
      found = openOk(x, z);
    }
    if (!found) continue;
    const gx = (h0(x + 4, z) - h0(x - 4, z)) / 8;
    const gz = (h0(x, z + 4) - h0(x, z - 4)) / 8;
    let ang = Math.hypot(gx, gz) > 0.02 ? Math.atan2(gx, -gz) : rnd(41, hedge) * Math.PI * 2; // perpendicular to the gradient
    const length = 80 + 170 * rnd(42, hedge);
    for (let walked = 0; walked < length && placed < hedgeBudget; ) {
      if (!openOk(x, z)) break;
      serial += 1;
      const lat = (rnd(43, serial) - 0.5) * 2.4;
      openTree(x - Math.sin(ang) * lat, z + Math.cos(ang) * lat, 'hedgerow', serial, 0.05);
      placed += 1;
      const step = 8 + 3 * rnd(44, serial);
      ang += (rnd(45, serial) - 0.5) * 0.25;
      x += Math.cos(ang) * step;
      z += Math.sin(ang) * step;
      walked += step;
    }
  }

  // solitary field trees (orchard remnants, boundary oaks, field limes)
  const soloBudget = Math.max(0, budget - riparianBudget - hedgeBudget);
  placed = 0;
  for (let k = 0; k < soloBudget * 20 && placed < soloBudget; k += 1) {
    const x = b.x0 + rnd(50, k, 0) * (b.x1 - b.x0);
    const z = b.z0 + rnd(50, k, 1) * (b.z1 - b.z0);
    if (!openOk(x, z)) continue;
    serial += 1;
    openTree(x, z, 'solitary', serial, 0.15);
    placed += 1;
  }

  const byId = new Map<string, Tree>();
  const index = new SpatialHash<Tree>(32);
  for (const t of trees) {
    byId.set(t.id, t);
    index.insert(t, t.x, t.z);
  }
  return { trees: Object.freeze(trees), byId, index, forestShare };
}

const memo = new Map<string, BaseVegetation>();

function fingerprint(t: TerrainPort): string {
  const b = t.bounds;
  let acc = 0;
  for (let k = 0; k < 16; k += 1) acc += t.originalHeightAt(b.x0 + ((k % 4) + 0.37) * ((b.x1 - b.x0) / 4), b.z0 + (Math.floor(k / 4) + 0.61) * ((b.z1 - b.z0) / 4)) * (k + 1);
  return `${JSON.stringify(t.grid)}:${acc}:${t.waterBodies().length}`;
}

export function baseVegetation(ctx: ReadCtx): BaseVegetation {
  const settings = ctx.data('terrainSettings');
  const species = ctx.data('treeSpecies');
  const terrain = ctx.port('terrain');
  const key = `${ctx.seed >>> 0}|${JSON.stringify(settings)}|${JSON.stringify(species)}|${fingerprint(terrain)}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const v = generateVegetation(ctx.seed, settings, species, terrain);
  memo.set(key, v);
  if (memo.size > 6) memo.delete(memo.keys().next().value!);
  return v;
}

export function createVegetationPort(ctx: ReadCtx): VegetationPort {
  let base: BaseVegetation | undefined;
  const B = (): BaseVegetation => (base ??= baseVegetation(ctx));
  const state = (): Readonly<VegetationState> => ctx.state('vegetation');
  let cachedRemoved: unknown;
  let removedSet = new Set<string>();
  let current: readonly Tree[] = [];
  const sync = (): void => {
    const st = state();
    if (cachedRemoved === st.removed) return;
    removedSet = new Set(st.removed);
    current = Object.freeze(B().trees.filter((t) => !removedSet.has(t.id)));
    cachedRemoved = st.removed;
  };
  return {
    trees() {
      sync();
      return current;
    },
    treesIn(polygon) {
      sync();
      if (polygon.length < 3) return [];
      return B()
        .index.queryBounds(polygonBounds(polygon))
        .filter((t) => !removedSet.has(t.id) && containsXZ(polygon, t.x, t.z));
    },
    treesNear(p, radius) {
      sync();
      return B()
        .index.queryRadius(p[0], p[1], radius)
        .filter((t) => !removedSet.has(t.id));
    },
    species(id) {
      const sp = ctx.data('treeSpecies')[id];
      if (!sp) throw new Error(`Unknown tree species ${id}`);
      return sp;
    },
    wood(t) {
      const sp = ctx.data('treeSpecies')[t.species];
      if (!sp) throw new Error(`Unknown tree species ${t.species}`);
      const stemVolume = sp.formFactor.value * Math.PI * (t.dbh / 2) ** 2 * t.height;
      const stem = stemVolume * sp.woodDensity.value;
      return { stemVolume, stem, crown: stem * sp.crownWood.value };
    },
    tree(id) {
      sync();
      const t = B().byId.get(id);
      return t && !removedSet.has(id) ? t : undefined;
    },
    revision: () => state().revision,
  };
}
