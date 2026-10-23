/**
 * Soil physics: pure functions (no state, no ports) so they can be tested and reused.
 *
 * Water: single-bucket (Ein-Schicht-Speicher) model of the root zone, as used in agro-
 * meteorological practice (e.g. FAO-56 soil water balance, the DWD's AMBAV/METVER family in
 * simplified form). Storage between wilting point and field capacity is the plant-available
 * water (nFK); water above field capacity drains with an exponential recession whose rate
 * depends on texture; storage above saturation runs off.
 *
 * Frost: Stefan-type rule z = k·√FI (Stefan 1891; modified Berggren, Aldrich & Paynter 1953)
 * with an empirical coefficient k ≈ 0.04–0.06 m/√(K·d) on the AIR freezing index. This is the
 * rule of thumb behind German frost-depth estimates (frost index maps of the DWD used for the
 * RStO 12 frost-action zones; typical design statements such as "FI ≈ 300 K·d → ~0.8 m"):
 * dry granular soils (high conductivity, little latent heat) sit at the upper end, wet
 * cohesive soils at the lower end. Snow cover insulates (n-factor < 1).
 */
import type { SoilClass } from '../../terrain/src/index.ts';

/** Solar constant 0.0820 MJ m⁻² min⁻¹ (FAO-56 eq. 21). */
const GSC = 0.082;

/**
 * Extraterrestrial radiation Ra (MJ m⁻² d⁻¹) for latitude (deg N) and day of year
 * (FAO-56, Allen et al. 1998, eqs. 21–25). At 51° N: ~41.5 in late June, ~4 in December.
 */
export function extraterrestrialRadiation(latDeg: number, dayOfYear: number): number {
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos(((2 * Math.PI) / 365) * dayOfYear);
  const delta = 0.409 * Math.sin(((2 * Math.PI) / 365) * dayOfYear - 1.39);
  const x = Math.min(1, Math.max(-1, -Math.tan(phi) * Math.tan(delta)));
  const ws = Math.acos(x);
  const ra = ((24 * 60) / Math.PI) * GSC * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
  return Math.max(0, ra);
}

/**
 * Reference evapotranspiration ET0 (mm/d) after Hargreaves & Samani (1985), FAO-56 eq. 52:
 * ET0 = 0.0023 · (Tmean + 17.8) · √(Tmax − Tmin) · 0.408 · Ra.
 * Needs only temperature, which is what a daily weather generator delivers robustly.
 * Central Germany: ~4–5 mm/d on a warm summer day, ~0.2–0.5 mm/d in winter, ~600 mm/a.
 */
export function hargreavesET0(tMin: number, tMax: number, tMean: number, ra: number): number {
  const range = Math.max(0, tMax - tMin);
  return Math.max(0, 0.0023 * (tMean + 17.8) * Math.sqrt(range) * 0.408 * ra);
}

/** Crop coefficient for a grass/arable mosaic averaged over the year (FAO-56 Kc ≈ 0.75–0.85). */
export const CROP_COEFFICIENT = 0.8;
/** Depletion fraction p: ET falls below potential once half the plant-available water is used (FAO-56 Table 22, grass). */
export const DEPLETION_FRACTION = 0.5;
/** Root zone depth for the bucket (m): typical effective rooting depth of grass/cereals on loess (KA5 "We"). */
export const ROOT_DEPTH = 1.0;
/** Degree-day snowmelt factor (mm K⁻¹ d⁻¹): 2–5 in Central European lowlands (HBV-type models). */
export const SNOW_DDF = 3;
/** Thawing removes frozen depth faster than freezing builds it (solar input, rain heat, ground heat from below). */
export const THAW_RATE = 1.5;
/** Plausibility cap on frost depth (m): measured maxima in Germany stay below ~1.5–2 m even in 1929/1963. */
export const MAX_FROST_DEPTH = 2.0;

export interface CellSoil {
  /** plant-available water capacity of the root zone (mm) */
  capacity: number;
  /** fraction of the water above field capacity that drains per day */
  drainage: number;
  /** storage above field capacity before saturation, as a fraction of capacity */
  excessMax: number;
  /** Stefan coefficient for this soil at field capacity (m/√(K·d)) */
  frostK: number;
  /** working layer (first subsoil) is cohesive: sensitive to wetness for trafficking/compaction */
  cohesive: boolean;
}

/**
 * Cell parameters from a soil column (layers measured downward from the surface as it is).
 * Capacity integrates each layer's nFK (mm/m) over the root zone; drainage and frost
 * coefficients come from the first subsoil (the layer that controls percolation and in
 * which earthworks operate — topsoil is stripped before construction, and may be already).
 */
export function cellSoil(layers: readonly { classId: string; thickness: number }[], classOf: (id: string) => SoilClass): CellSoil {
  let capacity = 0;
  let depth = 0;
  for (const layer of layers) {
    const take = Math.min(layer.thickness, ROOT_DEPTH - depth);
    if (take <= 0) break;
    capacity += classOf(layer.classId).fieldCapacity.value * take;
    depth += take;
  }
  // (the first below any topsoil: where a field is stripped, the one now at the top)
  const working = classOf((layers.find((l) => classOf(l.classId).group !== 'topsoil') ?? layers[0])!.classId);
  const h = working.hydraulics;
  return { capacity: Math.max(capacity, 10), drainage: h.drainage.value, excessMax: h.excessStorage.value, frostK: Math.sqrt(h.stefan.value), cohesive: working.cohesive };
}

/**
 * Moisture correction of the Stefan coefficient: frost penetration is inversely
 * proportional to √(latent heat), i.e. to √(water content). Relative to field capacity:
 * k(m) = k_fc · √(1 / (0.6 + 0.4·m)), bounded to ±20 %.
 */
export function frostCoefficient(cell: CellSoil, moisture: number): number {
  const f = Math.sqrt(1 / (0.6 + 0.4 * Math.max(0, moisture)));
  return cell.frostK * Math.min(1.2, Math.max(0.85, f));
}

/** Snow-cover n-factor (surface/air freezing index ratio): ~0.4 under > 20 mm SWE (~10 cm snow). */
export function snowNFactor(snowWater: number): number {
  if (snowWater > 20) return 0.4;
  if (snowWater > 5) return 0.7;
  return 1;
}

export interface BucketStep {
  /** new relative moisture */
  moisture: number;
  et: number;
  drainage: number;
  runoff: number;
}

/**
 * One daily bucket step. `input` is infiltrating water (rain + snowmelt, mm), `etc` the crop
 * ET demand (mm). Actual ET is reduced linearly once more than p·capacity is depleted
 * (FAO-56 Ks). Frozen subsoil blocks percolation (perched water over frost).
 */
export function bucketStep(cell: CellSoil, moisture: number, input: number, etc: number, frozen: boolean): BucketStep {
  const c = cell.capacity;
  let w = moisture * c + input;
  const ks = Math.min(1, w / ((1 - DEPLETION_FRACTION) * c));
  const et = Math.min(w, etc * ks);
  w -= et;
  let drainage = 0;
  if (w > c) {
    drainage = (w - c) * cell.drainage * (frozen ? 0.1 : 1);
    w -= drainage;
  }
  let runoff = 0;
  const wMax = c * (1 + cell.excessMax);
  if (w > wMax) {
    runoff = w - wMax;
    w = wMax;
  }
  return { moisture: Math.max(0, w / c), et, drainage, runoff };
}

/**
 * Frost depth after one day, Stefan form integrated incrementally: d² grows by k²·F on
 * freezing days (F = n·|Tmean|) and shrinks by THAW_RATE·k²·Tmean on thawing days. For a
 * constant k and an uninterrupted cold spell this is exactly d = k·√FI.
 */
export function frostStep(depth: number, k: number, tMean: number, nFactor: number): number {
  let d2 = depth * depth;
  if (tMean < 0) d2 += k * k * -tMean * nFactor;
  else if (tMean > 0 && d2 > 0) d2 = Math.max(0, d2 - THAW_RATE * k * k * tMean);
  return Math.min(MAX_FROST_DEPTH, Math.sqrt(d2));
}

/**
 * Climatological relative soil moisture (fraction of nFK) by month for loamy soils under
 * grass in central Germany — rough long-term means after the DWD soil moisture monitoring
 * (field capacity in winter, deepest depletion in August). Used to initialise new worlds.
 */
export const CLIMATOLOGICAL_MOISTURE = [1.0, 1.0, 0.95, 0.85, 0.75, 0.6, 0.5, 0.45, 0.5, 0.6, 0.8, 0.95];
