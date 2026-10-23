/**
 * Conformance suites of the terrain and vegetation contracts (decision 0015): the generated terrain and vegetation and
 * the fakes of `@cc/terrain/testing` (design/modular-split.md §7.2) must all pass them. They ask what the fakes can
 * answer: heights, water, soil columns, the ground's grid, profiles, trees. Earthworks (dig, fill, water drawn) are the
 * real terrain's alone and are tested with it.
 */
import { check, Runtime, type ConformanceSuite, type RuntimeConfig } from '../../kernel/src/index.ts';
import { polygonArea, type Vec2 } from '../../geo/src/index.ts';
import type { TerrainPort, Tree, VegetationPort } from './contract.ts';

export interface TerrainSubject {
  /** the configuration of a world with the implementation under test (same every call) */
  config(): RuntimeConfig;
}

export type VegetationSubject = TerrainSubject;

/** points spread over the map, a few hundred */
const samples = (t: TerrainPort): Vec2[] => {
  const b = t.bounds;
  const out: Vec2[] = [];
  for (let i = 0; i <= 16; i += 1) for (let j = 0; j <= 16; j += 1) out.push([b.x0 + ((b.x1 - b.x0) * (i + 0.37)) / 17.5, b.z0 + ((b.z1 - b.z0) * (j + 0.61)) / 17.5]);
  return out;
};

const terrainOf = (subject: TerrainSubject): { rt: Runtime; t: TerrainPort } => {
  const rt = Runtime.create(subject.config());
  return { rt, t: rt.read.port('terrain') };
};

const fmt = (p: Vec2): string => `(${p[0].toFixed(1)}, ${p[1].toFixed(1)})`;

/** the column's class at a depth, walking its layers down */
const layerAt = (layers: readonly { classId: string; thickness: number }[], depth: number): string => {
  let d = 0;
  for (const l of layers) {
    d += l.thickness;
    if (depth < d) return l.classId;
  }
  return layers.at(-1)!.classId;
};

export const terrainConformance: ConformanceSuite<TerrainSubject> = {
  contract: 'terrain',
  cases: [
    {
      name: 'the surface: heights finite, the grid its heights, slopes not negative, normals up',
      run(subject) {
        const { t } = terrainOf(subject);
        const g = t.grid;
        const h = t.heights();
        check(g.cell > 0 && g.nx > 1 && g.nz > 1 && h.length === g.nx * g.nz, `a grid of ${g.nx} × ${g.nz} with ${h.length} heights`);
        for (let j = 0; j < g.nz; j += Math.max(1, Math.floor(g.nz / 13))) for (let i = 0; i < g.nx; i += Math.max(1, Math.floor(g.nx / 13))) check(Math.abs(t.heightAt(g.x0 + i * g.cell, g.z0 + j * g.cell) - h[j * g.nx + i]!) < 1e-3, `vertex ${i}, ${j}: heightAt ${t.heightAt(g.x0 + i * g.cell, g.z0 + j * g.cell)}, heights() ${h[j * g.nx + i]}`);
        for (const [x, z] of samples(t)) {
          check(Number.isFinite(t.heightAt(x, z)) && Number.isFinite(t.originalHeightAt(x, z)), `${fmt([x, z])}: height ${t.heightAt(x, z)}`);
          check(t.slopeAt(x, z) >= 0, `${fmt([x, z])}: slope ${t.slopeAt(x, z)}`);
          const [nx, ny, nz] = t.normalAt(x, z);
          check(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-6 && ny > 0, `${fmt([x, z])}: normal ${[nx, ny, nz]}`);
          check(Math.abs(Math.hypot(nx, nz) / ny - t.slopeAt(x, z)) < 1e-6, `${fmt([x, z])}: the normal leans ${Math.hypot(nx, nz) / ny}, the slope is ${t.slopeAt(x, z)}`);
        }
      },
    },
    {
      name: 'water: never less than none; a pond has a level and a volume, or neither',
      run(subject) {
        const { t } = terrainOf(subject);
        for (const [x, z] of samples(t)) check(t.waterDepthAt(x, z) >= 0 && Number.isFinite(t.waterDepthAt(x, z)), `${fmt([x, z])}: water ${t.waterDepthAt(x, z)} m`);
        const ponds = t.waterBodies().filter((w) => w.kind === 'pond');
        check((t.pondLevel() === undefined) === (t.pondVolume() === undefined), `pond level ${t.pondLevel()}, volume ${t.pondVolume()}`);
        check((t.pondLevel() === undefined) === (ponds.length === 0), `${ponds.length} ponds, level ${t.pondLevel()}`);
        if (t.pondVolume() !== undefined) check(t.pondVolume()! >= 0, `pond volume ${t.pondVolume()}`);
        for (const w of t.waterBodies()) check(w.points.length >= 2 && w.levels.length >= 1 && w.levels.every(Number.isFinite), `water body ${w.id}: ${w.points.length} points, levels ${w.levels}`);
      },
    },
    {
      name: 'soil: columns of known classes and positive layers; the class at a depth is the layer there',
      run(subject) {
        const { t } = terrainOf(subject);
        for (const [x, z] of samples(t)) {
          for (const [col, what] of [[t.soilAt(x, z), 'soilAt'], [t.soilMapColumn(x, z), 'soilMapColumn']] as const) {
            check(col.layers.length > 0 && col.rockDepth >= 0, `${fmt([x, z])} ${what}: ${col.layers.length} layers, rock at ${col.rockDepth} m`);
            for (const l of col.layers) {
              check(l.thickness > 0, `${fmt([x, z])} ${what}: a layer of ${l.thickness} m`);
              check(t.soilClass(l.classId).label.length > 0, `${fmt([x, z])} ${what}: class ${l.classId} unknown`);
            }
          }
          const col = t.soilAt(x, z);
          for (const d of [0, 0.2, 1, 2.5, 6]) {
            check(t.soilClassAtDepth(x, z, d) === layerAt(col.layers, d), `${fmt([x, z])} at ${d} m: ${t.soilClassAtDepth(x, z, d)}, the column says ${layerAt(col.layers, d)}`);
            check(t.soilMapAt(x, z, d) === layerAt(t.soilMapColumn(x, z).layers, d), `${fmt([x, z])} at ${d} m: the map says ${t.soilMapAt(x, z, d)}, its column ${layerAt(t.soilMapColumn(x, z).layers, d)}`);
          }
        }
        let threw = false;
        try {
          t.soilClass('no-such-class');
        } catch {
          threw = true;
        }
        check(threw, 'an unknown soil class was answered');
      },
    },
    {
      name: "the ground's grid: a polygon covers its area in cells, each where groundAt says",
      run(subject) {
        const { t } = terrainOf(subject);
        const b = t.bounds;
        const cx = (b.x0 + b.x1) / 2 + 13.3;
        const cz = (b.z0 + b.z1) / 2 - 7.7;
        const square: Vec2[] = [[cx, cz], [cx + 20, cz], [cx + 20, cz + 15], [cx, cz + 15]];
        const tri: Vec2[] = [[cx - 30, cz - 30], [cx, cz - 30], [cx - 30, cz]];
        for (const poly of [square, tri]) {
          const cells = t.cover(poly);
          const area = cells.reduce((a, c) => a + c[2], 0);
          check(cells.every((c) => Math.abs(c[2] - t.cellArea) < 1e-9), 'a cell covered is not of the cell area');
          check(Math.abs(area - polygonArea(poly)) <= 0.1 * polygonArea(poly) + 4 * t.cellArea, `covers ${area} m² of a polygon of ${polygonArea(poly)} m²`);
          check(new Set(cells.map((c) => `${c[0]},${c[1]}`)).size === cells.length, 'a cell is covered twice');
          for (const [fi, fj] of cells.slice(0, 40)) {
            const g = t.groundAt(fi, fj);
            const side = Math.sqrt(t.cellArea);
            const inside = g.x >= Math.min(...poly.map((p) => p[0])) - side && g.x <= Math.max(...poly.map((p) => p[0])) + side && g.z >= Math.min(...poly.map((p) => p[1])) - side && g.z <= Math.max(...poly.map((p) => p[1])) + side;
            check(inside, `cell ${fi}, ${fj} at (${g.x}, ${g.z}) lies outside the polygon it covers`);
            check(Number.isFinite(g.h) && g.column.layers.length > 0, `cell ${fi}, ${fj}: height ${g.h}`);
          }
        }
      },
    },
    {
      name: 'a profile follows its line: heights, original heights and water as at its points',
      run(subject) {
        const { t } = terrainOf(subject);
        const b = t.bounds;
        const line: Vec2[] = [[b.x0 + 50, b.z0 + 60], [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2], [b.x1 - 70, b.z0 + 40]];
        const prof = t.profile(line, 25);
        check(prof.length > 2 && prof[0]!.s === 0, `${prof.length} samples`);
        prof.forEach((p, i) => {
          if (i > 0) check(p.s > prof[i - 1]!.s, `chainage ${p.s} after ${prof[i - 1]!.s}`);
          check(Math.abs(p.h - t.heightAt(p.x, p.z)) < 1e-6 && Math.abs(p.h0 - t.originalHeightAt(p.x, p.z)) < 1e-6 && Math.abs(p.water - t.waterDepthAt(p.x, p.z)) < 1e-6, `sample at ${p.s} m differs from the point's own`);
        });
        check(Math.hypot(prof.at(-1)!.x - line[2]![0], prof.at(-1)!.z - line[2]![1]) < 1e-6, 'the profile does not end at its line’s end');
      },
    },
    {
      name: 'deterministic: two worlds made alike have the same ground; it holds still unchanged; a restored snapshot has it too',
      run(subject) {
        const a = terrainOf(subject);
        const b = terrainOf(subject);
        const ground = (t: TerrainPort) => JSON.stringify([t.bounds, t.grid, Array.from(t.heights().filter((_, k) => k % 97 === 0)), samples(t).map(([x, z]) => [t.heightAt(x, z), t.waterDepthAt(x, z), t.soilAt(x, z)]), t.waterBodies(), t.pondLevel()]);
        const first = ground(a.t);
        check(first === ground(b.t), 'two worlds made alike differ in their ground');
        const rev = a.t.revision();
        const h = a.t.heights();
        check(ground(a.t) === first && a.t.revision() === rev && a.t.heights() === h, 'the ground changed while nothing was done to it');
        const back = Runtime.restore(subject.config(), JSON.parse(JSON.stringify(a.rt.snapshot())));
        check(ground(back.read.port('terrain')) === first, 'the restored world has a different ground');
      },
    },
  ],
};

const vegetationOf = (subject: VegetationSubject): { rt: Runtime; v: VegetationPort } => {
  const rt = Runtime.create(subject.config());
  return { rt, v: rt.read.port('vegetation') };
};

/** some trees to ask about, spread over the list */
const someOf = (trees: readonly Tree[]): Tree[] => trees.filter((_, i) => i % Math.max(1, Math.floor(trees.length / 25)) === 0);

export const vegetationConformance: ConformanceSuite<VegetationSubject> = {
  contract: 'vegetation',
  cases: [
    {
      name: 'every tree is a tree: a known species, a trunk, a height, a crown, and wood of it',
      run(subject) {
        const { v } = vegetationOf(subject);
        const trees = v.trees();
        check(trees.length > 0, 'no trees to look at (give the subject some)');
        check(new Set(trees.map((t) => t.id)).size === trees.length, 'two trees share an id');
        for (const t of trees) {
          check(Number.isFinite(t.x) && Number.isFinite(t.z) && t.dbh > 0 && t.height > 0 && t.crownRadius >= 0, `tree ${t.id}: dbh ${t.dbh} m, ${t.height} m high, crown ${t.crownRadius} m`);
          check(v.species(t.species).label.length > 0, `tree ${t.id}: species ${t.species} unknown`);
        }
        for (const t of someOf(trees)) {
          const w = v.wood(t);
          check(w.stemVolume > 0 && w.stem > 0 && w.crown >= 0, `tree ${t.id}: wood ${JSON.stringify(w)}`);
          check(JSON.stringify(v.tree(t.id)) === JSON.stringify(t), `tree(${t.id}) is not that tree`);
        }
        check(v.tree('no-such-tree') === undefined, 'a tree that is not there was found');
      },
    },
    {
      name: 'the trees near a point and in a polygon are those of all the trees that are there',
      run(subject) {
        const { v } = vegetationOf(subject);
        const trees = v.trees();
        const ids = (list: readonly Tree[]) => list.map((t) => t.id).sort().join(',');
        for (const c of someOf(trees)) {
          const p: Vec2 = [c.x + 3.3, c.z - 2.1];
          for (const r of [5, 30]) {
            // (leaving out trees on the circle's very edge)
            const edge = (t: Tree) => Math.abs(Math.hypot(t.x - p[0], t.z - p[1]) - r) < 1e-6;
            const want = trees.filter((t) => !edge(t) && Math.hypot(t.x - p[0], t.z - p[1]) <= r);
            check(ids(v.treesNear(p, r).filter((t) => !edge(t))) === ids(want), `near ${fmt(p)} within ${r} m: ${v.treesNear(p, r).length} trees, ${want.length} there`);
          }
          const box: Vec2[] = [[p[0] - 20.05, p[1] - 15.05], [p[0] + 20.05, p[1] - 15.05], [p[0] + 20.05, p[1] + 15.05], [p[0] - 20.05, p[1] + 15.05]];
          const want = trees.filter((t) => Math.abs(t.x - p[0]) < 20.05 && Math.abs(t.z - p[1]) < 15.05);
          check(ids(v.treesIn(box)) === ids(want), `in a box at ${fmt(p)}: ${v.treesIn(box).length} trees, ${want.length} there`);
        }
      },
    },
    {
      name: 'deterministic: two worlds made alike have the same trees; they stand still unchanged; a restored snapshot has them too',
      run(subject) {
        const a = vegetationOf(subject);
        const b = vegetationOf(subject);
        const first = JSON.stringify(a.v.trees());
        check(first === JSON.stringify(b.v.trees()), 'two worlds made alike have different trees');
        const rev = a.v.revision();
        check(JSON.stringify(a.v.trees()) === first && a.v.revision() === rev, 'the trees changed while nothing was done to them');
        const back = Runtime.restore(subject.config(), JSON.parse(JSON.stringify(a.rt.snapshot())));
        check(JSON.stringify(back.read.port('vegetation').trees()) === first, 'the restored world has different trees');
      },
    },
  ],
};
