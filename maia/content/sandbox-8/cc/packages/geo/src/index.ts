/**
 * @cc/geo — pure geometry & grid utilities (no module, no state):
 * polylines & chainage, fillets, corridors, polygons, grids, spatial hash, coherent noise.
 */
export * from './types.ts';
export { clamp, clamp01, lerp, smoothstep, EPS, leftNormal, pointSegment } from './math.ts';
import { add, cross, dist, dist2, dot, len, normalize, scale, sub } from './math.ts';
/** Small 2D vector helpers on `[x, z]` tuples. */
export const vec2 = { add, sub, scale, dot, cross, len, dist, dist2, normalize };
export * from './polyline.ts';
export * from './polygon.ts';
export * from './grid.ts';
export * from './spatial.ts';
export * from './noise.ts';
export * from './footprint.ts';
