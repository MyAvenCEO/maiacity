/**
 * The criteria: physical quantities over the land, computed on a grid from what a scout can know.
 */
import { daysFromCivil, type ReadCtx, type Source } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import { planeIrradiance } from '../../environment/src/index.ts';
import { clearSkyGhiIneichen, cloudFactor, sunPosition, sunTimes } from '../../weather/src/index.ts';
import type { Criterion, SiteGrid } from './contract.ts';

/** grid cell size (m) */
export const CELL = 20;

const TPI: Source = { title: 'Weiss (2001): Topographic Position and Landforms Analysis (topographic position index); cold air pools in hollows, ridges are exposed', publisher: 'ESRI User Conference' };
const ERBS_SKY: Source = { title: 'Clear-sky radiation (Ineichen & Perez 2002) attenuated by the monthly sunshine normals, on the slope by the Erbs split (Erbs et al. 1982)', publisher: 'Solar Energy' };

export const CRITERIA: Criterion[] = [
  { id: 'slope', label: 'Slope', unit: '%', description: 'Gradient of the ground: building platforms, fields and tracks want it gentle.', knowledge: 'topographic map' },
  { id: 'aboveWater', label: 'Height above water', unit: 'm', description: 'Height above the water level of the nearest creek or pond (within 600 m): how far floods must rise to reach the place.', knowledge: 'topographic map' },
  { id: 'toWater', label: 'Distance to water', unit: 'm', description: 'Distance to the nearest creek or pond: water for people, animals and work.', knowledge: 'topographic map' },
  { id: 'toRoad', label: 'Distance to a road', unit: 'm', description: 'Distance to the nearest road (built or planned): how far every load must cross open ground.', knowledge: 'what is built' },
  { id: 'flatArea', label: 'Level ground nearby', unit: 'm²', description: 'Ground gentler than 5 % within 80 m: room for buildings, yards and fields.', knowledge: 'topographic map' },
  { id: 'terrainPosition', label: 'Terrain position', unit: 'm', description: 'Height above the mean ground within 150 m: negative in hollows (cold air pools, frost pockets, wet), positive on ridges (exposed to wind).', knowledge: 'topographic map', source: TPI },
  { id: 'sun', label: 'Sun on the ground', unit: '%', description: 'Yearly solar radiation on the ground as a share of level ground: south slopes gain, north slopes lose.', knowledge: 'climate normals', source: ERBS_SKY },
  { id: 'soilWater', label: 'Soil water for plants', unit: 'mm', description: 'Plant-available water the soil holds in the top metre: what carries crops through dry spells.', knowledge: 'the region’s soil map (test pits reveal more)' },
  { id: 'drainage', label: 'Drainage', unit: '1/d', description: 'Share of the water above field capacity the subsoil drains per day: firm, dry building ground and passable tracks need it high.', knowledge: 'the region’s soil map (test pits reveal more)' },
  { id: 'timber', label: 'Timber within 250 m', unit: 'm³', description: 'Standing stem volume of the trees within 250 m: building timber and firewood within reach.', knowledge: 'the woods one can see' },
];

export interface Land {
  read: ReadCtx;
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  centre(i: number, j: number): Vec2;
}

export function landOf(read: ReadCtx): Land {
  const g = read.port('terrain').grid;
  const x0 = g.x0;
  const z0 = g.z0;
  const nx = Math.floor(((g.nx - 1) * g.cell) / CELL);
  const nz = Math.floor(((g.nz - 1) * g.cell) / CELL);
  return { read, x0, z0, nx, nz, centre: (i, j) => [x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL] };
}

function gridOf(land: Land, c: Criterion, fill: (i: number, j: number, k: number) => number): SiteGrid {
  const values = new Float32Array(land.nx * land.nz);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < land.nz; j += 1) {
    for (let i = 0; i < land.nx; i += 1) {
      const k = j * land.nx + i;
      const v = fill(i, j, k);
      values[k] = v;
      if (Number.isFinite(v)) {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
  }
  return { id: c.id, label: c.label, unit: c.unit, x0: land.x0, z0: land.z0, cell: CELL, nx: land.nx, nz: land.nz, values, min, max };
}

/** sum of a grid within a radius of each cell (cells) */
function radiusSum(land: Land, src: Float32Array, radiusCells: number, mean = false): Float32Array {
  const out = new Float32Array(src.length);
  const r2 = radiusCells * radiusCells;
  for (let j = 0; j < land.nz; j += 1) {
    for (let i = 0; i < land.nx; i += 1) {
      let s = 0;
      let n = 0;
      for (let dj = -radiusCells; dj <= radiusCells; dj += 1) {
        const jj = j + dj;
        if (jj < 0 || jj >= land.nz) continue;
        for (let di = -radiusCells; di <= radiusCells; di += 1) {
          const ii = i + di;
          if (ii < 0 || ii >= land.nx || di * di + dj * dj > r2) continue;
          s += src[jj * land.nx + ii]!;
          n += 1;
        }
      }
      out[j * land.nx + i] = mean ? s / Math.max(1, n) : s;
    }
  }
  return out;
}

/** water samples: creek centrelines and pond outlines with their levels */
function waterSamples(land: Land): { p: Vec2; level: number }[] {
  const out: { p: Vec2; level: number }[] = [];
  for (const w of land.read.port('terrain').waterBodies()) {
    w.points.forEach((p, n) => {
      const prev = w.points[n - 1];
      const level = w.levels[Math.min(n, w.levels.length - 1)]!;
      // densify to ≤ 10 m so distances are not off by half a segment
      if (prev) {
        const len = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        const steps = Math.ceil(len / 10);
        const l0 = w.levels[Math.min(n - 1, w.levels.length - 1)]!;
        for (let k = 1; k < steps; k += 1) out.push({ p: [prev[0] + ((p[0] - prev[0]) * k) / steps, prev[1] + ((p[1] - prev[1]) * k) / steps], level: l0 + ((level - l0) * k) / steps });
      }
      out.push({ p, level });
    });
  }
  return out;
}

/** monthly sunshine-weighted solar gain on a slope relative to level ground (climatological) */
function sunFactorFn(read: ReadCtx): (slopeDeg: number, aspectDeg: number) => number {
  const c = read.data('climate');
  const { lat, lon } = c.station;
  const tz = c.station.utcOffset.value;
  const elevation = c.station.elevation.value;
  const linke = c.generator.linkeTurbidity?.values ?? new Array<number>(12).fill(3.5);
  const hours: { sunEl: number; sunAz: number; ghi: number; doy: number }[] = [];
  for (let m = 0; m < 12; m += 1) {
    const day = daysFromCivil(2001, m + 1, 15);
    const doy = day - daysFromCivil(2001, 1, 1) + 1;
    const t = sunTimes(day, lat, lon, tz);
    const dayLen = t.kind === 'normal' ? t.sunset - t.sunrise : t.kind === 'polarDay' ? 24 : 0;
    const monthDays = (m === 11 ? daysFromCivil(2002, 1, 1) : daysFromCivil(2001, m + 2, 1)) - daysFromCivil(2001, m + 1, 1);
    const relSun = dayLen > 0 ? Math.min(1, c.monthly.sunshine.values[m]! / (dayLen * monthDays)) : 0;
    for (let h = 0; h < 24; h += 1) {
      const pos = sunPosition(day, h + 0.5, lat, lon, tz);
      if (pos.elevation <= 0) continue;
      hours.push({ sunEl: pos.elevation, sunAz: pos.azimuth, ghi: clearSkyGhiIneichen(pos.cosZenith, elevation, linke[m]!, doy) * cloudFactor(1 - relSun), doy });
    }
  }
  const memo = new Map<string, number>();
  const flat = hours.reduce((a, x) => a + x.ghi, 0);
  return (slopeDeg, aspectDeg) => {
    const s = Math.round(slopeDeg / 2.5) * 2.5;
    const a = Math.round(aspectDeg / 22.5) * 22.5;
    const key = `${s}:${a}`;
    let f = memo.get(key);
    if (f === undefined) {
      const sr = (s * Math.PI) / 180;
      const ar = (a * Math.PI) / 180;
      const n: [number, number, number] = [Math.sin(sr) * Math.sin(ar), Math.cos(sr), -Math.sin(sr) * Math.cos(ar)];
      f = flat > 0 ? hours.reduce((acc, x) => acc + planeIrradiance(x.ghi, x.sunEl, x.sunAz, x.doy, n, 0.2), 0) / flat : 1;
      memo.set(key, f);
    }
    return f;
  };
}

/** compute one criterion over the land */
export function computeCriterion(land: Land, id: string): SiteGrid {
  const c = CRITERIA.find((x) => x.id === id);
  if (!c) throw new Error(`siting: no criterion '${id}'`);
  const { read } = land;
  const terrain = read.port('terrain');
  switch (id) {
    case 'slope':
      return gridOf(land, c, (i, j) => terrain.slopeAt(...land.centre(i, j)) * 100);
    case 'aboveWater':
    case 'toWater': {
      const water = waterSamples(land);
      return gridOf(land, c, (i, j) => {
        const [x, z] = land.centre(i, j);
        let best = Infinity;
        let level = NaN;
        for (const w of water) {
          const d = Math.hypot(w.p[0] - x, w.p[1] - z);
          if (d < best) {
            best = d;
            level = w.level;
          }
        }
        if (id === 'toWater') return Math.min(best, 5000);
        return best <= 600 ? terrain.heightAt(x, z) - level : 50;
      });
    }
    case 'toRoad': {
      const routing = read.port('routing');
      return gridOf(land, c, (i, j) => routing.nearest(land.centre(i, j), { maxDistance: 2000 })?.distance ?? 2000);
    }
    case 'flatArea': {
      const flat = new Float32Array(land.nx * land.nz);
      for (let j = 0; j < land.nz; j += 1) for (let i = 0; i < land.nx; i += 1) flat[j * land.nx + i] = terrain.slopeAt(...land.centre(i, j)) <= 0.05 ? CELL * CELL : 0;
      const sum = radiusSum(land, flat, Math.round(80 / CELL));
      return gridOf(land, c, (_i, _j, k) => sum[k]!);
    }
    case 'terrainPosition': {
      const h = new Float32Array(land.nx * land.nz);
      for (let j = 0; j < land.nz; j += 1) for (let i = 0; i < land.nx; i += 1) h[j * land.nx + i] = terrain.heightAt(...land.centre(i, j));
      const mean = radiusSum(land, h, Math.round(150 / CELL), true);
      return gridOf(land, c, (_i, _j, k) => h[k]! - mean[k]!);
    }
    case 'sun': {
      const f = sunFactorFn(read);
      return gridOf(land, c, (i, j) => {
        const n = terrain.normalAt(...land.centre(i, j));
        const slope = (Math.acos(Math.max(-1, Math.min(1, n[1]))) * 180) / Math.PI;
        const aspect = Math.hypot(n[0], n[2]) < 1e-6 ? 0 : (((Math.atan2(n[0], -n[2]) * 180) / Math.PI) % 360 + 360) % 360;
        return f(slope, aspect) * 100;
      });
    }
    case 'soilWater':
    case 'drainage': {
      // the region's soil map: its column for the unit there (anyone's knowledge, 8d)
      const block = new Map<string, number>();
      return gridOf(land, c, (i, j) => {
        const [x, z] = land.centre(i, j);
        const col = terrain.soilMapColumn(x, z);
        const key = col.layers.map((l) => `${l.classId}:${l.thickness.toFixed(2)}`).join('|');
        let v = block.get(key);
        if (v === undefined) {
          if (id === 'soilWater') {
            let depth = 0;
            v = 0;
            for (const l of col.layers) {
              const take = Math.min(l.thickness, 1 - depth);
              if (take <= 0) break;
              v += terrain.soilClass(l.classId).fieldCapacity.value * take;
              depth += take;
            }
          } else v = terrain.soilClass((col.layers[1] ?? col.layers[0])!.classId).hydraulics.drainage.value;
          block.set(key, v);
        }
        return v;
      });
    }
    case 'timber': {
      const vol = new Float32Array(land.nx * land.nz);
      const veg = read.port('vegetation');
      for (const t of veg.trees()) {
        const i = Math.floor((t.x - land.x0) / CELL);
        const j = Math.floor((t.z - land.z0) / CELL);
        if (i < 0 || j < 0 || i >= land.nx || j >= land.nz) continue;
        vol[j * land.nx + i]! += veg.wood(t).stemVolume;
      }
      const sum = radiusSum(land, vol, Math.round(250 / CELL));
      return gridOf(land, c, (_i, _j, k) => sum[k]!);
    }
  }
  throw new Error(`siting: criterion '${id}' has no computation`);
}
