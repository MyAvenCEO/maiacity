/**
 * Surface finishes for kit-built models: each vertex carries how rough and how metallic its part is and which surface
 * pattern it shows (brick courses, roof tiles, boards, logs, woven fabric, render, concrete, wood grain), drawn in the
 * object's own metres so a brick is a brick at any size of building. One material serves them all; patterns fade into
 * their mean colour where they would shimmer (far off, or seen at a grazing angle).
 */
import { MeshStandardMaterial, type MeshStandardMaterialParameters } from 'three';

/** roughness, metalness, pattern */
export type Finish = readonly [number, number, number];

export const PATTERN = { plain: 0, brick: 1, tile: 2, boards: 3, fabric: 4, render: 5, concrete: 6, grain: 7, logs: 8, rough: 9, corrugated: 10, blocks: 11 } as const;

export const FIN = {
  paint: [0.5, 0.12, 0],
  gloss: [0.26, 0.3, 0],
  metal: [0.38, 0.85, 0],
  dull: [0.6, 0.55, 0],
  galv: [0.48, 0.8, 0],
  rubber: [0.93, 0, 0],
  glass: [0.05, 0.15, 0],
  plastic: [0.55, 0, 0],
  lens: [0.15, 0.1, 0],
  wood: [0.78, 0, PATTERN.grain],
  boards: [0.85, 0, PATTERN.boards],
  logs: [0.9, 0, PATTERN.logs],
  bark: [0.95, 0, PATTERN.rough],
  rough: [0.97, 0, PATTERN.rough],
  fabric: [0.88, 0, PATTERN.fabric],
  nylon: [0.62, 0, PATTERN.fabric],
  brick: [0.92, 0, PATTERN.brick],
  tile: [0.62, 0, PATTERN.tile],
  render: [0.95, 0, PATTERN.render],
  concrete: [0.95, 0, PATTERN.concrete],
  sheet: [0.45, 0.7, PATTERN.corrugated],
  matte: [0.9, 0, 0],
  card: [0.85, 0, 0],
} as const satisfies Record<string, Finish>;

export type FinishName = keyof typeof FIN;

const VERT_HEAD = /* glsl */ `
attribute vec3 fin;
varying vec3 vFin;
varying vec3 vOPos;
varying vec3 vONrm;
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vFin;
varying vec3 vOPos;
varying vec3 vONrm;
float fh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fn(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fh(i), fh(i + vec3(1, 0, 0)), f.x), mix(fh(i + vec3(0, 1, 0)), fh(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(fh(i + vec3(0, 0, 1)), fh(i + vec3(1, 0, 1)), f.x), mix(fh(i + vec3(0, 1, 1)), fh(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
/* the plane a face lies in: a wall's along it and up, a roof's or floor's across */
vec2 facePlane(vec3 p, vec3 n) {
  vec3 a = abs(n);
  if (a.y > 0.75) return p.xz;
  return a.x > a.z ? vec2(p.z, p.y) : vec2(p.x, p.y);
}
/* how much of a pattern of this period can be shown without shimmering */
float keep(float v, float period) { return clamp(1.0 - fwidth(v) / period * 2.2, 0.0, 1.0); }
vec3 finishPattern(vec3 base, float pat) {
  vec3 p = vOPos;
  vec3 n = normalize(vONrm);
  float g = fn(p * 7.0) * 0.6 + fn(p * 23.0) * 0.4;
  vec3 c = base * (0.965 + 0.07 * g);
  if (pat < 0.5) return c;
  vec2 uv = facePlane(p, n);
  if (pat < 1.5) {
    // NF bricks, 240 x 71 mm, 10/12 mm joints, stretcher bond
    float h = 0.083;
    float row = floor(uv.y / h);
    float u = uv.x + mod(row, 2.0) * 0.125;
    float col = floor(u / 0.25);
    float jx = step(fract(u / 0.25) * 0.25, 0.011);
    float jy = step(fract(uv.y / h) * h, 0.012);
    vec3 brick = base * (0.82 + 0.3 * h2(vec2(row, col))) * (0.94 + 0.12 * fn(p * 40.0));
    vec3 mortar = mix(base, vec3(0.74, 0.71, 0.66), 0.75);
    vec3 b = mix(brick, mortar, max(jx, jy));
    return mix(c, b, keep(uv.y, h));
  }
  if (pat < 2.5) {
    // roof tiles: courses up the slope, each tile's lower edge in its own shadow
    float h = 0.2;
    float row = floor(p.y / h);
    float v = fract(p.y / h);
    float u = p.x + mod(row, 2.0) * 0.15;
    float col = floor(u / 0.3);
    float joint = smoothstep(0.0, 0.03, fract(u / 0.3)) * smoothstep(1.0, 0.95, fract(u / 0.3));
    vec3 t = base * (0.66 + 0.42 * v) * (0.86 + 0.24 * h2(vec2(row, col))) * (0.7 + 0.3 * joint);
    return mix(c * 0.92, t, keep(p.y, h));
  }
  if (pat < 3.5) {
    // boards, some 15 cm wide, with dark joints and grain along them
    float h = 0.15;
    float row = floor(uv.y / h);
    float j = step(fract(uv.y / h), 0.06);
    float grain = fn(vec3(uv.x * 1.5, uv.y * 60.0, row));
    vec3 b = base * (0.85 + 0.2 * h2(vec2(row, 3.0))) * (0.9 + 0.18 * grain) * (1.0 - 0.45 * j);
    return mix(c, b, keep(uv.y, h));
  }
  if (pat < 4.5) {
    // woven fabric: a fine weave, seams and the soft wrinkles of a sheet under tension
    float w = sin(uv.x * 260.0) * sin(uv.y * 260.0);
    float seam = step(fract(uv.x / 1.4), 0.012) + step(fract(uv.y / 1.4), 0.012);
    float wr = fn(vec3(uv * 2.2, 1.0));
    vec3 f = base * (0.9 + 0.16 * wr) * (1.0 - 0.18 * min(seam, 1.0));
    f *= 1.0 + 0.05 * w * keep(uv.x, 0.03);
    return mix(c, f, keep(uv.y, 1.4) * 0.7 + 0.3);
  }
  if (pat < 5.5) {
    // render: a fine speckle, darker where the rain splashes it near the ground
    float s = fn(p * 55.0);
    vec3 r = base * (0.93 + 0.1 * s) * (1.0 - 0.1 * smoothstep(0.7, 0.0, p.y) * (0.6 + 0.4 * fn(p * 4.0)));
    return mix(c, r, 0.85);
  }
  if (pat < 6.5) {
    // concrete: blotches and the joints of its shuttering
    float b = fn(p * 3.0) * 0.5 + fn(p * 13.0) * 0.5;
    float j = step(fract(uv.x / 2.5), 0.004) + step(fract(uv.y / 1.25), 0.004);
    return base * (0.86 + 0.22 * b) * (1.0 - 0.15 * min(j, 1.0) * keep(uv.x, 1.25));
  }
  if (pat < 7.5) {
    // wood grain along the longest axis of the part, unknown here: along x, y or z by the face
    vec3 q = p * vec3(6.0, 6.0, 6.0);
    float gr = fn(vec3(q.x * 0.15 + q.z * 0.15, q.y * 9.0, q.z * 9.0 + q.x * 9.0));
    return base * (0.84 + 0.3 * gr);
  }
  if (pat < 8.5) {
    // log courses: each a round log, lit on top, shaded under, its bark rough
    float h = 0.24;
    float v = fract(uv.y / h);
    float round = sin(3.14159 * v);
    float bark = fn(vec3(uv.x * 9.0, uv.y * 30.0, floor(uv.y / h)));
    vec3 l = base * (0.45 + 0.6 * round) * (0.82 + 0.3 * bark) * (0.9 + 0.2 * h2(vec2(floor(uv.y / h), 7.0)));
    return mix(c * 0.85, l, keep(uv.y, h));
  }
  if (pat < 9.5) {
    // rough: bark, brash, earth
    float r = fn(p * 9.0) * 0.5 + fn(p * 31.0) * 0.5;
    return base * (0.7 + 0.55 * r);
  }
  if (pat > 10.5) {
    // clay blocks (Planziegel 248 x 249 mm faces, 25 cm courses, thin-bed joints, toothed ends), half a block in bond
    float h = 0.25;
    float row = floor(uv.y / h);
    float u = uv.x + mod(row, 2.0) * 0.124;
    float col = floor(u / 0.248);
    float jx = step(fract(u / 0.248) * 0.248, 0.004);
    float jy = step(fract(uv.y / h) * h, 0.004);
    float ribs = 0.5 + 0.5 * sin(uv.y / 0.0125 * 6.2831);
    vec3 bl = base * (0.86 + 0.2 * h2(vec2(row, col))) * (0.95 + 0.06 * ribs * keep(uv.y, 0.0125));
    return mix(c, mix(bl, base * 0.55, max(jx, jy)), keep(uv.y, h));
  }
  // corrugated sheet: ribs every 7.6 cm
  float rib = 0.5 + 0.5 * sin(uv.x / 0.076 * 6.2831);
  return mix(c, base * (0.8 + 0.3 * rib), keep(uv.x, 0.076));
}
`;

/** a material for kit geometry: vertex colours, and each vertex's finish (geometry without `fin` must not use it) */
export function finishMaterial(params: MeshStandardMaterialParameters = {}, key = 'fin'): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, ...params });
  patchFinish(m, key);
  return m;
}

export function patchFinish(m: MeshStandardMaterial, key = 'fin'): void {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vFin = fin; vOPos = position; vONrm = normal;');
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = finishPattern(diffuseColor.rgb, vFin.z);')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vFin.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vFin.y;');
  };
  m.customProgramCacheKey = () => `finish-${key}`;
}
