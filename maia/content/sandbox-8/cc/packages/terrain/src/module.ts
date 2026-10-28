/**
 * Terrain and vegetation modules.
 *
 * Authoritative state is tiny: edited height tiles and removed tree ids. Everything else
 * (base heights, soils, water, trees) is re-derived from seed + data on demand.
 */
import { command, defineModule, s, type WriteCtx } from '../../kernel/src/index.ts';
import { containsXZ, gridPosition, type Vec2 } from '../../geo/src/index.ts';
import { SoilClassSchema, TerrainSettingsSchema, TreeSpeciesSchema, type DigResult, type GroundCell, type Stratum, type TerrainState, type VegetationState } from './contract.ts';
import type { BaseTerrain } from './generate.ts';
import { basinVolume, createTerrainPort, groundGrid, GroundWriter, soilColumnAt, TILE, tileKey, type TerrainPortImpl } from './terrain-port.ts';
import { createVegetationPort } from './vegetation.ts';

const BoundsSchema = s.object({ x0: s.number({ unit: 'm' }), z0: s.number({ unit: 'm' }), x1: s.number({ unit: 'm' }), z1: s.number({ unit: 'm' }) });

/** Edits may lower terrain by up to 300 m (quarries) or raise it by up to 100 m (dams, tips). */
const MAX_CUT = 300;
const MAX_FILL = 100;
/** how far from the pond's edge someone draws from it (m) */
const DRAW_REACH = 15;

/** whether a point is inside an outline or within `r` of it */
function outlineNear(outline: Vec2[], p: Vec2, r: number): boolean {
  if (containsXZ(outline, p[0], p[1])) return true;
  for (let k = 0; k < outline.length; k += 1) {
    const a = outline[k]!;
    const b = outline[(k + 1) % outline.length]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
    if (Math.hypot(a[0] + t * dx - p[0], a[1] + t * dz - p[1]) <= r) return true;
  }
  return false;
}

/**
 * `d` m off a cell's column from the top: what was laid first, then the original column (below the vertex it belongs
 * to); the pieces taken, each of its class and density. Only topsoil, when only topsoil is taken (a strip): it stops
 * at the first layer that is not.
 */
function take(base: BaseTerrain, classOf: (id: string) => { group: string }, ground: GroundWriter, key: number, idx: number, d: number, topsoilOnly = false): Stratum[] {
  const was = ground.get(key);
  const laid = (was?.laid ?? []).map((l) => ({ ...l }));
  let cut = was?.cut ?? 0;
  const out: Stratum[] = [];
  let left = d;
  while (left > 1e-12 && laid.length) {
    const top = laid[0]!;
    if (topsoilOnly && classOf(top.cls).group !== 'topsoil') {
      left = 0;
      break;
    }
    const t = Math.min(top.t, left);
    out.push({ cls: top.cls, t, ...(top.rho !== undefined ? { rho: top.rho } : {}) });
    top.t -= t;
    left -= t;
    if (top.t <= 1e-12) laid.shift();
  }
  // (then the original column, below what is gone of it already)
  let off = cut;
  for (const l of soilColumnAt(base, idx).layers) {
    if (left <= 1e-12) break;
    const there = l.thickness - Math.min(off, l.thickness);
    off = Math.max(0, off - l.thickness);
    if (there <= 1e-12) continue;
    if (topsoilOnly && classOf(l.classId).group !== 'topsoil') break;
    const t = Math.min(there, left);
    out.push({ cls: l.classId, t });
    cut += t;
    left -= t;
  }
  ground.set(key, { cut, laid });
  return out;
}

/** `d` m of a class laid on a cell, at a density as laid if given (on a stratum of the same class and density: thicker) */
function lay(ground: GroundWriter, key: number, cls: string, d: number, rho?: number): void {
  const cell = ground.get(key) ?? { cut: 0, laid: [] };
  const laid = cell.laid.map((l) => ({ ...l }));
  if (laid[0]?.cls === cls && laid[0].rho === rho) laid[0].t += d;
  else laid.unshift({ cls, t: d, ...(rho !== undefined ? { rho } : {}) });
  ground.set(key, { cut: cell.cut, laid });
}

/** the height vertices changed by so much of their cells' ground (each vertex: the mean of its cells), as heights to write */
function vertexEdits(base: BaseTerrain, heights: Float32Array, dv: Map<number, number>): [number, number, number][] {
  const g = base.grid;
  return [...dv.entries()].sort(([a], [b]) => a - b).map(([idx, d]): [number, number, number] => [idx % g.nx, Math.floor(idx / g.nx), heights[idx]! + d]);
}

/** the heights the strata give, written to the tiles (copy-on-write), with the strata, as one change of the ground */
function writeHeights(ctx: WriteCtx, cells: [number, number, number][], reason: string, ground: Record<string, Record<string, GroundCell>>): void {
  const port = ctx.port('terrain') as TerrainPortImpl;
  const g = port.base().grid;
  const st = ctx.state('terrain');
  const heights = port.heights();
  const tiles: Record<string, number[]> = { ...st.tiles };
  const touched = new Set<string>();
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [i, j, h] of cells) {
    const ti = Math.floor(i / TILE);
    const tj = Math.floor(j / TILE);
    const key = tileKey(ti, tj);
    if (!touched.has(key)) {
      // copy-on-write: start from the existing tile or from the current surface
      let tile = tiles[key] ? [...tiles[key]!] : undefined;
      if (!tile) {
        tile = new Array<number>(TILE * TILE).fill(0);
        for (let lj = 0; lj < TILE; lj += 1) {
          for (let li = 0; li < TILE; li += 1) {
            const gi = ti * TILE + li;
            const gj = tj * TILE + lj;
            if (gi < g.nx && gj < g.nz) tile[lj * TILE + li] = heights[gj * g.nx + gi]!;
          }
        }
      }
      tiles[key] = tile;
      touched.add(key);
    }
    tiles[key]![(j - tj * TILE) * TILE + (i - ti * TILE)] = h;
    const [x, z] = gridPosition(g, i, j);
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  }
  // (the pond's water as it is the moment its basin may change: it comes back to the new water table from now)
  const pondNow = port.pondVolume();
  ctx.setState('terrain', { ...st, tiles, ground, revision: st.revision + 1, ...(pondNow !== undefined ? { pond: { volume: pondNow, at: ctx.now } } : {}) });
  ctx.emit('terrain.changed', { bounds: { x0, z0, x1, z1 }, cells: cells.length, reason });
}

export const terrainModule = defineModule({
  id: 'terrain',
  commandDocs: {
    "terrain.setHeights": {
      internal: true,
    }
  },
  label: 'Terrain',
  description: 'The ground: heights derived from its strata (the base from seed and settings, what was dug and laid since), soil columns, the creek and the pond with its water.',
  provides: ['terrain'],
  data: {
    soilClasses: s.record(SoilClassSchema),
    terrainSettings: TerrainSettingsSchema,
  },
  state: {
    schema: s.object({
      tiles: s.record(s.array(s.number())),
      revision: s.int({ min: 0 }),
      ground: s.record(s.record(s.object({ cut: s.number({ min: 0, unit: 'm' }), laid: s.array(s.object({ cls: s.string(), t: s.number({ min: 0, unit: 'm' }), rho: s.number({ min: 0, unit: 't/m3' }).optional() })) }))).optional(),
      pond: s.object({ volume: s.number({ min: 0, unit: 'm3' }), at: s.number({ unit: 's' }) }).optional(),
    }),
    initial: (): TerrainState => ({ tiles: {}, revision: 0 }),
  },
  events: {
    'terrain.changed': s.object({ bounds: BoundsSchema, cells: s.int({ min: 0 }), reason: s.string() }),
  },
  blockers: {
    'terrain.badCell': 'Height edit #{index} is invalid: {problem}',
    'terrain.heightOutOfRange': 'Height edit #{index} sets {h} m, outside the plausible range {min}–{max} m',
  },
  commands: {
    // world definition only (setup, trusted tests): the ground cut down or raised as if it had always been so; what is
    // raised is laid of the class at its top (design/physical-state.md §5: in play the ground changes by dig and fill)
    'terrain.setHeights': command(
      s.object({ cells: s.array(s.array(s.number())), reason: s.string() }),
      (ctx, p) => {
        if (!ctx.setup && !ctx.trusted) throw new Error('terrain.setHeights: the ground changes only by digging and filling (terrain.dig, terrain.fill) once the world is made');
        const port = ctx.port('terrain') as TerrainPortImpl;
        const base = port.base();
        const g = base.grid;
        const lo = base.minHeight - MAX_CUT;
        const hi = base.maxHeight + MAX_FILL;
        p.cells.forEach((c, index) => {
          if (c.length !== 3) ctx.reject('terrain.badCell', { index, problem: 'expected [i, j, h]' });
          const [i, j, h] = c as [number, number, number];
          if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= g.nx || j >= g.nz) {
            ctx.reject('terrain.badCell', { index, problem: `vertex (${i}, ${j}) outside grid ${g.nx}×${g.nz}` });
          }
          if (h < lo || h > hi) ctx.reject('terrain.heightOutOfRange', { index, h, min: Math.round(lo), max: Math.round(hi) });
        });
        if (p.cells.length === 0) return 0;
        const fg = groundGrid(base);
        const ground = new GroundWriter(ctx.state('terrain').ground, fg.nx);
        const heights = port.heights();
        const classOf = (id: string) => port.soilClass(id);
        for (const c of p.cells) {
          const [i, j, h] = c as [number, number, number];
          const idx = j * g.nx + i;
          const d = h - heights[idx]!;
          // (every cell of the vertex's square by as much)
          for (let sj = 0; sj < fg.per; sj += 1) {
            for (let si = 0; si < fg.per; si += 1) {
              const fi = i * fg.per + si;
              const fj = j * fg.per + sj;
              const key = fj * fg.nx + fi;
              if (d < 0) take(base, classOf, ground, key, idx, -d);
              else if (d > 0) lay(ground, key, port.groundAt(fi, fj).column.layers[0]?.classId ?? base.soil.roles.classIds[base.soil.roles.topsoil]!, d);
            }
          }
        }
        writeHeights(ctx, p.cells.map((c) => [c[0]!, c[1]!, c[2]!]), p.reason, ground.out);
        return p.cells.length;
      },
      'Set terrain vertex heights (world definition)',
    ),
    // so many m³ dug at grid vertices: what lies there comes out, layer by layer, as goods into a store (topsoil, fill or
    // spoil by its class), and the ground is lower by what was taken (findings 9–12)
    'terrain.dig': command(
      s.object({ cells: s.array(s.array(s.number())), as: s.object({ topsoil: s.string(), fill: s.string(), spoil: s.string() }), into: s.ref('store'), why: s.string(), topsoilOnly: s.boolean().optional() }),
      (ctx, p): DigResult => {
        const port = ctx.port('terrain') as TerrainPortImpl;
        const base = port.base();
        const fg = groundGrid(base);
        const area = port.cellArea;
        const ground = new GroundWriter(ctx.state('terrain').ground, fg.nx);
        const heights = port.heights();
        const won: Record<string, number> = {};
        const dv = new Map<number, number>();
        let m3 = 0;
        for (const c of p.cells) {
          const [fi, fj, v] = c as [number, number, number];
          if (!(v > 1e-9) || !Number.isInteger(fi) || !Number.isInteger(fj) || fi < 0 || fj < 0 || fi >= fg.nx || fj >= fg.nz) continue;
          const idx = fg.vertex(fi, fj);
          const pieces = take(base, (id) => port.soilClass(id), ground, fj * fg.nx + fi, idx, v / area, p.topsoilOnly);
          let d = 0;
          for (const piece of pieces) {
            const cls = port.soilClass(piece.cls);
            const mat = cls.group === 'topsoil' ? p.as.topsoil : cls.suitableFill ? p.as.fill : p.as.spoil;
            // (laid fill weighs as it was laid, the ground as it lies)
            won[mat] = (won[mat] ?? 0) + piece.t * area * (piece.rho ?? cls.bulkDensity.value);
            d += piece.t;
          }
          // (the ground is lower by what was taken: a strip finding no topsoil takes nothing)
          dv.set(idx, (dv.get(idx) ?? 0) - d / (fg.per * fg.per));
          m3 += d * area;
        }
        if (!dv.size) return { won, m3: 0 };
        const edits = vertexEdits(base, heights, dv);
        if (!(m3 > 1e-12)) return { won, m3: 0 };
        writeHeights(ctx, edits, p.why, ground.out);
        for (const [material, qty] of Object.entries(won).sort(([a], [b]) => (a < b ? -1 : 1))) {
          if (qty > 1e-9) ctx.command('inventory.extract', { from: 'ground', into: p.into, material, qty, why: p.why });
        }
        return { won, m3 };
      },
      { label: 'Ground dug (by the work that digs it)', internal: true },
    ),
    // goods from a store laid at grid vertices, so many m³ at each, as a stratum of a soil class
    'terrain.fill': command(
      s.object({ cells: s.array(s.array(s.number())), cls: s.string(), from: s.ref('store'), take: s.array(s.object({ material: s.string(), qty: s.number({ min: 0 }) })), tonnes: s.number({ min: 0, unit: 't' }).optional(), why: s.string() }),
      (ctx, p) => {
        const port = ctx.port('terrain') as TerrainPortImpl;
        const base = port.base();
        const fg = groundGrid(base);
        port.soilClass(p.cls);
        for (const t of p.take) if (t.qty > 1e-9) ctx.command('inventory.release', { from: p.from, material: t.material, qty: t.qty, to: 'ground', why: p.why });
        const ground = new GroundWriter(ctx.state('terrain').ground, fg.nx);
        const heights = port.heights();
        const dv = new Map<number, number>();
        // (laid at the density it has: the goods' mass over the volume they make)
        const vol = p.cells.reduce((a, c) => a + Math.max(0, c[2] ?? 0), 0);
        const rho = p.tonnes !== undefined && vol > 1e-9 ? p.tonnes / vol : undefined;
        for (const c of p.cells) {
          const [fi, fj, v] = c as [number, number, number];
          if (!(v > 1e-9) || !Number.isInteger(fi) || !Number.isInteger(fj) || fi < 0 || fj < 0 || fi >= fg.nx || fj >= fg.nz) continue;
          const d = v / port.cellArea;
          lay(ground, fj * fg.nx + fi, p.cls, d, rho);
          const idx = fg.vertex(fi, fj);
          dv.set(idx, (dv.get(idx) ?? 0) + d / (fg.per * fg.per));
        }
        if (dv.size) writeHeights(ctx, vertexEdits(base, heights, dv), p.why, ground.out);
      },
      { label: 'Ground filled (by the work that lays it)', internal: true },
    ),
    // water drawn where it is: from the pond (its volume less), or from the creek (flowing water)
    'terrain.draw': command(
      s.object({ at: s.point(), material: s.string(), qty: s.number({ min: 0 }), m3: s.number({ min: 0 }), into: s.ref('store'), why: s.string() }),
      (ctx, p): number => {
        const port = ctx.port('terrain') as TerrainPortImpl;
        const b = port.base();
        let qty = p.qty;
        if (b.pond && outlineNear(b.pond.outline, p.at, DRAW_REACH)) {
          const v = port.pondVolume() ?? 0;
          const m3 = Math.min(p.m3, v);
          qty = p.m3 > 0 ? (p.qty * m3) / p.m3 : 0;
          ctx.setState('terrain', { ...ctx.state('terrain'), pond: { volume: v - m3, at: ctx.now } });
        }
        if (qty > 1e-9) ctx.command('inventory.extract', { from: 'water', into: p.into, material: p.material, qty, why: p.why });
        return qty;
      },
      { label: 'Water drawn where it is', internal: true },
    ),
  },
  ports: {
    terrain: (ctx) => createTerrainPort(ctx),
  },
  projections: {
    'terrain.summary': {
      label: 'Terrain summary',
      compute: (ctx) => {
        const t = ctx.port('terrain') as TerrainPortImpl;
        const b = t.base();
        return {
          bounds: b.bounds,
          grid: b.grid,
          minHeight: b.minHeight,
          maxHeight: b.maxHeight,
          revision: t.revision(),
          editedTiles: Object.keys(ctx.state('terrain').tiles).length,
          water: b.water.map((w) => ({ id: w.id, kind: w.kind, points: w.points.length })),
        };
      },
    },
  },
  setup(ctx) {
    // generate eagerly so bad settings fail at world creation, not at first use
    const b = (ctx.port('terrain') as TerrainPortImpl).base();
    // the pond's water as the world is made: its basin full to the water table
    if (b.pond && !ctx.state('terrain').pond) ctx.setState('terrain', { ...ctx.state('terrain'), pond: { volume: basinVolume(b, b.heights, b.pond.level), at: ctx.now } });
  },
});

export const vegetationModule = defineModule({
  id: 'vegetation',
  commandDocs: {
    "vegetation.removeTrees": {
      internal: true,
    }
  },
  label: 'Vegetation',
  description: 'Woodland, hedgerows, riparian and solitary trees derived from seed + settings; removals as state.',
  provides: ['vegetation'],
  requires: ['terrain'],
  data: {
    treeSpecies: s.record(TreeSpeciesSchema),
  },
  state: {
    schema: s.object({ removed: s.array(s.string()), revision: s.int({ min: 0 }) }),
    initial: (): VegetationState => ({ removed: [], revision: 0 }),
  },
  events: {
    'vegetation.changed': s.object({ removed: s.array(s.string()), reason: s.string() }),
  },
  blockers: {
    'vegetation.unknownTree': 'There is no tree {id}',
  },
  commands: {
    'vegetation.removeTrees': command(
      s.object({ ids: s.array(s.string()), reason: s.string() }),
      (ctx, p) => {
        const veg = ctx.port('vegetation');
        const st = ctx.state('vegetation');
        const already = new Set(st.removed);
        const fresh: string[] = [];
        for (const id of p.ids) {
          if (already.has(id)) continue; // idempotent: felling a felled tree is a no-op
          if (!veg.tree(id)) ctx.reject('vegetation.unknownTree', { id });
          already.add(id);
          fresh.push(id);
        }
        if (fresh.length === 0) return 0;
        ctx.setState('vegetation', { removed: [...st.removed, ...fresh], revision: st.revision + 1 });
        ctx.emit('vegetation.changed', { removed: fresh, reason: p.reason });
        return fresh.length;
      },
      'Remove (fell) trees',
    ),
  },
  ports: {
    vegetation: (ctx) => createVegetationPort(ctx),
  },
  projections: {
    'vegetation.summary': {
      label: 'Vegetation summary',
      compute: (ctx) => {
        const trees = ctx.port('vegetation').trees();
        const bySetting: Record<string, number> = {};
        const bySpecies: Record<string, number> = {};
        for (const t of trees) {
          bySetting[t.setting ?? 'unknown'] = (bySetting[t.setting ?? 'unknown'] ?? 0) + 1;
          bySpecies[t.species] = (bySpecies[t.species] ?? 0) + 1;
        }
        return { count: trees.length, bySetting, bySpecies, revision: ctx.port('vegetation').revision() };
      },
    },
  },
  setup(ctx) {
    ctx.port('vegetation').trees();
  },
});
