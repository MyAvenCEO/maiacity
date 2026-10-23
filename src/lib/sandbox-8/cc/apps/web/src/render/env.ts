/**
 * Environment: sky dome, sun / moon light with view-fitted shadows, hemisphere fill, fog and rain.
 * Everything follows the simulated weather (sun position, cloud cover, precipitation) unless
 * `realLighting` is off, which gives a fixed pleasant afternoon.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  FogExp2,
  HemisphereLight,
  LineSegments,
  Mesh,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Hud } from '../protocol.ts';

const DEG = Math.PI / 180;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float sunVis;
uniform float glow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c;
  if (h >= 0.0) {
    float t = pow(clamp(h, 0.0, 1.0), 0.45);
    c = mix(horizon, zenith, t);
  } else {
    c = mix(horizon, ground, smoothstep(0.0, 0.35, -h));
  }
  float sd = max(dot(d, normalize(sunDir)), 0.0);
  c += sunColor * (pow(sd, 6.0) * 0.22 + pow(sd, 48.0) * 0.35) * glow;
  c += sunColor * smoothstep(0.99955, 0.9998, sd) * sunVis * 1.6;
  // subtle dithering against banding
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

const RAIN_VERT = /* glsl */ `
attribute vec4 seed;
uniform float time;
uniform vec3 center;
uniform float size;
uniform float height;
uniform float streak;
uniform vec2 wind;
varying float vA;
void main() {
  float fall = 9.0;
  vec3 p;
  p.x = fract(seed.x + time * wind.x / size) - 0.5;
  p.z = fract(seed.z + time * wind.y / size) - 0.5;
  p.y = fract(seed.y - time * fall / height);
  vec3 w = vec3(center.x + p.x * size, center.y + p.y * height, center.z + p.z * size);
  // streak: top vertex (seed.w = 0) offset upwards along the fall vector
  w += seed.w * vec3(-wind.x, fall, -wind.y) / fall * streak;
  vA = (1.0 - abs(p.x) * 2.0) * (1.0 - abs(p.z) * 2.0) * smoothstep(0.0, 0.15, p.y) * smoothstep(1.0, 0.8, p.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const RAIN_FRAG = /* glsl */ `
uniform float opacity;
uniform vec3 color;
varying float vA;
void main() { gl_FragColor = vec4(color, opacity * vA); }`;

export interface EnvState {
  elevation: number;
  azimuth: number;
  cloud: number;
  precip: number;
  wind: number;
  temp: number;
}

export class Environment {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly fog: FogExp2;
  private sky: Mesh;
  private skyMat: ShaderMaterial;
  private rain: LineSegments;
  private rainMat: ShaderMaterial;
  realLighting = true;
  shadowsOn = true;
  /** set by the scene from the HUD */
  state: EnvState = { elevation: 38, azimuth: 225, cloud: 0.2, precip: 0, wind: 2, temp: 15 };
  private lightDir = new Vector3(0.5, 0.7, 0.4);
  private tmpV = new Vector3();
  private tmpU = new Vector3();
  private tmpW = new Vector3();
  private cZen = new Color();
  private cHor = new Color();
  private cGnd = new Color();
  private cSun = new Color();
  private cTmp = new Color();
  /** horizon colour (fog), exposed for the clear colour */
  readonly horizon = new Color();
  private shadowExtent = 0;
  /** brightness of daylight 0..1 (for materials that care) */
  daylight = 1;
  /** suggested tone-mapping exposure */
  exposure = 1;
  /** bumps whenever the lighting changes materially (for reflections) */
  lightingVersion = 0;
  private lastKey = '';

  constructor(private scene: Scene) {
    this.skyMat = new ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        zenith: { value: new Vector3() },
        horizon: { value: new Vector3() },
        ground: { value: new Vector3() },
        sunDir: { value: new Vector3(0, 1, 0) },
        sunColor: { value: new Vector3(1, 1, 1) },
        sunVis: { value: 1 },
        glow: { value: 1 },
      },
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.sky = new Mesh(new SphereGeometry(1000, 32, 16), this.skyMat);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.sky.name = 'sky';
    scene.add(this.sky);

    this.sun = new DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 2.5;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 3000;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new HemisphereLight(0xbcd3ee, 0x5d5440, 1.1);
    scene.add(this.hemi);

    this.fog = new FogExp2(0xc8d6e0, 0.00022);
    scene.fog = this.fog;

    // rain: streaks in a box that follows the view
    const N = 5000;
    const seeds = new Float32Array(N * 2 * 4);
    const pos = new Float32Array(N * 2 * 3);
    let r = 1234567;
    const rnd = () => {
      r = (Math.imul(r, 1103515245) + 12345) >>> 0;
      return r / 4294967296;
    };
    for (let i = 0; i < N; i += 1) {
      const sx = rnd();
      const sy = rnd();
      const sz = rnd();
      for (let e = 0; e < 2; e += 1) {
        const k = (i * 2 + e) * 4;
        seeds[k] = sx;
        seeds[k + 1] = sy;
        seeds[k + 2] = sz;
        seeds[k + 3] = e;
      }
    }
    const rg = new BufferGeometry();
    rg.setAttribute('position', new Float32BufferAttribute(pos, 3));
    rg.setAttribute('seed', new Float32BufferAttribute(seeds, 4));
    this.rainMat = new ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: {
        time: { value: 0 },
        center: { value: new Vector3() },
        size: { value: 200 },
        height: { value: 120 },
        streak: { value: 1.2 },
        wind: { value: new Float32Array([1, 0.5]) },
        opacity: { value: 0.35 },
        color: { value: new Color(0xb8c4cf) },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    this.rain = new LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.renderOrder = 10;
    scene.add(this.rain);
    this.applyLighting();
  }

  setWeather(w: Hud['weather'] | undefined): void {
    if (!w) return;
    this.state.elevation = w.sunElevation;
    this.state.azimuth = w.sunAzimuth;
    this.state.cloud = Math.min(1, Math.max(0, w.cloud));
    this.state.precip = Math.max(0, w.precip);
    this.state.wind = w.wind;
    this.state.temp = w.temp;
    this.applyLighting();
  }

  applyLighting(): void {
    const real = this.realLighting;
    const el = real ? this.state.elevation : 36;
    const az = real ? this.state.azimuth : 215;
    const cloud = real ? this.state.cloud : 0.15;
    const precip = this.state.precip;
    const key = `${el.toFixed(1)}|${az.toFixed(0)}|${cloud.toFixed(2)}|${precip.toFixed(1)}|${real}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const day = smooth(-7, 6, el); // civil twilight → day
    const low = 1 - smooth(4, 28, el); // warm low sun
    this.daylight = day;
    const overcast = cloud * cloud * 0.9 + (precip > 0 ? 0.25 : 0);
    const oc = Math.min(1, overcast);

    // sun direction (azimuth clockwise from north, north = −z)
    const sunEl = Math.max(el, -10) * DEG;
    const sx = Math.sin(az * DEG) * Math.cos(sunEl);
    const sz = -Math.cos(az * DEG) * Math.cos(sunEl);
    const sy = Math.sin(sunEl);
    let lx = sx;
    let ly = sy;
    let lz = sz;
    let intensity: number;
    if (el > -2) {
      intensity = 3.1 * smooth(-2, 8, el) * (1 - 0.82 * oc);
      // keep a minimum light elevation for usable shadows
      if (ly < 0.12) {
        ly = 0.12;
      }
      this.cSun.setRGB(1, 0.94, 0.86).lerp(this.cTmp.setRGB(1, 0.62, 0.36), low * 0.85);
    } else {
      // moon: opposite azimuth, fixed elevation, cold and dim
      lx = -sx;
      lz = -sz;
      ly = 0.6;
      intensity = 0.55 * (1 - smooth(-12, -2, el)) * (1 - 0.5 * oc) + 0.1;
      this.cSun.setRGB(0.62, 0.72, 1.0);
    }
    this.lightDir.set(lx, ly, lz).normalize();
    // readability floor at dusk / night: a cool key light keeps ≥ ~35 % of daylight
    const floor = 0.9 * (1 - day);
    if (intensity < floor) {
      this.cSun.lerp(this.cTmp.setRGB(0.62, 0.72, 1.0), Math.min(1, (floor - intensity) / Math.max(floor, 1e-6)));
      intensity = floor;
      if (this.lightDir.y < 0.35) this.lightDir.setY(0.35).normalize();
    }
    this.sun.intensity = intensity;
    this.sun.color.copy(this.cSun);

    // sky colours (sRGB-space values used directly by the sky shader and the fog)
    const zen = this.cZen.set('#4f86c6');
    const hor = this.cHor.set('#c4d7e6');
    zen.lerp(this.cTmp.set('#6d90b8'), low * 0.5);
    hor.lerp(this.cTmp.set('#f0c9a0'), low * 0.75 * (1 - oc));
    // overcast greys
    zen.lerp(this.cTmp.set('#8e99a3'), oc);
    hor.lerp(this.cTmp.set('#b9c0c5'), oc);
    // night
    zen.lerp(this.cTmp.set('#142039'), 1 - day);
    hor.lerp(this.cTmp.set('#34465e'), 1 - day);
    const gnd = this.cGnd.copy(hor).lerp(this.cTmp.set('#6f7766'), 0.35);
    this.horizon.copy(hor);

    const u = this.skyMat.uniforms;
    const toVec = (c: Color, v: Vector3) => {
      c.getRGB(this.cTmp as never, SRGBColorSpace);
      v.set(this.cTmp.r, this.cTmp.g, this.cTmp.b);
    };
    toVec(zen, u.zenith!.value as Vector3);
    toVec(hor, u.horizon!.value as Vector3);
    toVec(gnd, u.ground!.value as Vector3);
    (u.sunDir!.value as Vector3).set(sx, sy, sz);
    (u.sunColor!.value as Vector3).set(1, 0.85 + 0.15 * (1 - low), 0.7 + 0.3 * (1 - low));
    u.sunVis!.value = el > -1 ? (1 - oc) * smooth(-1, 1, el) : 0;
    u.glow!.value = (1 - oc * 0.8) * day;

    // fog matches the horizon; denser in rain and at night less visible anyway
    this.fog.color.copy(hor);
    this.fog.density = 0.00024 + oc * 0.00012 + (precip > 0 ? 0.00025 * Math.min(1, precip / 3) : 0);

    // hemisphere fill
    this.hemi.color.set('#c3d6ec').lerp(this.cTmp.set('#d2d6da'), oc).lerp(this.cTmp.set('#6f88ba'), 1 - day);
    this.hemi.groundColor.set('#6a5f48').lerp(this.cTmp.set('#2c2c38'), 1 - day);
    this.hemi.intensity = 1.2 + 0.3 * day + oc * 0.7 * day;
    // keep night and dusk readable (a game, not a light meter)
    this.exposure = 1 + 0.55 * (1 - day);

    // rain
    this.rain.visible = precip > 0.05;
    this.rainMat.uniforms.opacity!.value = Math.min(0.55, 0.15 + precip * 0.08) * (0.35 + 0.65 * day);
    const isSnow = this.state.temp < 0.5;
    (this.rainMat.uniforms.color!.value as Color).set(isSnow ? 0xeeeeee : 0xaab7c4);
    this.lightingVersion += 1;
  }

  /** per frame: sky follows the camera, shadow camera fits the view, rain animates */
  update(camera: PerspectiveCamera, target: Vector3, distance: number, time: number): void {
    this.sky.position.copy(camera.position);
    this.sky.scale.setScalar(Math.min(camera.far * 0.9, 9000) / 1000);

    // shadow box around the target (quantised extent + texel snapping against shimmer)
    const want = Math.min(650, Math.max(70, distance * 0.95));
    const quant = Math.pow(1.2, Math.ceil(Math.log(want) / Math.log(1.2)));
    const R = quant;
    const sc = this.sun.shadow.camera;
    if (R !== this.shadowExtent) {
      this.shadowExtent = R;
      sc.left = -R;
      sc.right = R;
      sc.top = R;
      sc.bottom = -R;
      sc.updateProjectionMatrix();
      this.sun.shadow.normalBias = 0.25 + R / 900;
    }
    const d = this.lightDir;
    // centre slightly in front of the target (towards the camera's view direction)
    const c = this.tmpV.copy(target);
    const u = this.tmpU.set(0, 1, 0).cross(d);
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
    u.normalize();
    const v = this.tmpW.copy(d).cross(u).normalize();
    const texel = (2 * R) / this.sun.shadow.mapSize.x;
    const cu = c.dot(u);
    const cv = c.dot(v);
    c.addScaledVector(u, Math.round(cu / texel) * texel - cu).addScaledVector(v, Math.round(cv / texel) * texel - cv);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(d, 1200);
    this.sun.target.updateMatrixWorld();

    if (this.rain.visible) {
      const size = Math.min(500, Math.max(60, distance * 0.8));
      const ru = this.rainMat.uniforms;
      ru.time!.value = time;
      ru.size!.value = size;
      ru.height!.value = size * 0.7;
      ru.streak!.value = size * (this.state.temp < 0.5 ? 0.004 : 0.012);
      const ctr = ru.center!.value as Vector3;
      ctr.copy(camera.position).lerp(target, 0.55);
      ctr.y -= size * 0.35;
      const w = ru.wind!.value as Float32Array;
      w[0] = Math.min(6, this.state.wind) * 0.6;
      w[1] = Math.min(6, this.state.wind) * 0.3;
    }
  }

  dispose(): void {
    this.sky.geometry.dispose();
    this.skyMat.dispose();
    this.rain.geometry.dispose();
    this.rainMat.dispose();
    this.sun.dispose();
    this.scene.remove(this.sky, this.sun, this.sun.target, this.hemi, this.rain);
  }
}
