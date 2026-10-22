import RAPIER from '@dimforge/rapier3d-compat';
import { Simulation, transform, shapeVerticesOf, surfaceFacesOf, type Box, type V3 } from './simulation';
import { WindShelter } from './wind-shelter';

export const AIR_DENSITY = 1.225;
export const DRAG_COEFFICIENT = 1.2; // Illustrative uniform value, not calibrated to timber/buildings.
export const WIND_DIRECTIONS = {
  front: { x: 0, y: 0, z: -1 }, back: { x: 0, y: 0, z: 1 },
  left: { x: 1, y: 0, z: 0 }, right: { x: -1, y: 0, z: 0 },
} as const;
export type WindSettings = { enabled: boolean; speed: number; from: keyof typeof WIND_DIRECTIONS };
export type WindLoad = { force: V3; torque: V3; exposedArea: number; shelteredArea: number };
type Sample = { point: V3; normal: V3; area: number; piece: number };
const zero = (): V3 => ({ x: 0, y: 0, z: 0 });
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a: V3, n: number): V3 => ({ x: a.x * n, y: a.y * n, z: a.z * n });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const length = (a: V3) => Math.hypot(a.x, a.y, a.z);

function surfaceSamples(spec: Box): Sample[] {
  const samples: Sample[] = [];
  for (const {vertices:face,piece} of surfaceFacesOf(spec)) {
    if (face.length !== 4) {
      for (let t=1;t<face.length-1;t++) {
        const [a,b,c]=[face[0],face[t],face[t+1]], n=cross(sub(b,a),sub(c,a)), area=length(n)/2;
        for(const weights of [[2/3,1/6,1/6],[1/6,2/3,1/6],[1/6,1/6,2/3]])
          samples.push({point:add(add(mul(a,weights[0]),mul(b,weights[1])),mul(c,weights[2])),normal:mul(n,1/length(n)),area:area/3,piece});
      }
      continue;
    }
    const [a,b,c,d] = face;
    const n = cross(sub(b, a), sub(d, a));
    const area = (length(cross(sub(b, a), sub(c, a))) + length(cross(sub(c, a), sub(d, a)))) / 2;
    for (const u of [.25, .75]) for (const v of [.25, .75]) {
      const point = add(add(mul(a, (1-u)*(1-v)), mul(b, u*(1-v))), add(mul(c, u*v), mul(d, (1-u)*v)));
      samples.push({ point, normal: mul(n, 1 / length(n)), area: area / 4, piece });
    }
  }
  return samples;
}

/** A sampled drag approximation. It does not solve airflow, suction or lift. */
export class Wind {
  settings: WindSettings = { enabled: false, speed: 10, from: 'front' };
  readonly events: { tick: number; settings: WindSettings }[] = [];
  readonly loads = new Map<string, WindLoad>();
  private readonly samples = new Map<string, Sample[]>();
  private readonly vertices = new Map<string, V3[][]>();
  private readonly shelterHints = new WeakMap<Sample, RAPIER.Collider>();
  constructor(readonly sim: Simulation) { sim.environmentStep = () => this.apply(); }
  configure(settings: WindSettings) {
    if (!Number.isFinite(settings.speed) || settings.speed < 0 || !Object.hasOwn(WIND_DIRECTIONS, settings.from)) throw Error('Invalid wind settings');
    this.settings = { ...settings }; this.loads.clear();
    this.events.push({ tick: this.sim.ticks, settings: { ...settings } });
  }
  get velocity() { return mul(WIND_DIRECTIONS[this.settings.from], this.settings.speed); }
  measure() {
    this.loads.clear();
    if (!this.settings.enabled) return [];
    this.sim.world.propagateModifiedBodyPositionsToColliders();
    // Direct collider rays also see newly placed parts before their first world step.
    const blockers = new WindShelter([...this.sim.parts.values()].flatMap(p => {
      if (!this.vertices.has(p.spec.id)) this.vertices.set(p.spec.id, shapeVerticesOf(p.spec));
      const shapes = this.vertices.get(p.spec.id)!, rotation = p.body.rotation(), position = p.body.translation();
      return p.colliders.map((collider, i) => {
        const vertices = shapes[i];
        const center = transform(mul(vertices.reduce(add, zero()), 1 / vertices.length), rotation, position);
        const radius = Math.max(...vertices.map(v => length(sub(transform(v, rotation, position), center))));
        // Retain the original sphere prefilter. Tighter authored-vertex bounds
        // can discard hits accepted by Rapier's convex ray tolerances.
        const padding = radius + .00001;
        const min = sub(center, { x: padding, y: padding, z: padding });
        const max = add(center, { x: padding, y: padding, z: padding });
        return { collider, center, radius, min, max };
      });
    }));
    const applied: { id: string; point: V3; force: V3 }[] = [];
    const velocity = this.velocity;
    for (const [id, { spec, body, colliders }] of this.sim.parts) {
      if (spec.fixed) continue;
      if (!this.samples.has(id)) this.samples.set(id, surfaceSamples(spec));
      const load: WindLoad = { force: zero(), torque: zero(), exposedArea: 0, shelteredArea: 0 };
      this.loads.set(id, load);
      const rotation = body.rotation(), position = body.translation(), center = body.worldCom();
      for (const sample of this.samples.get(id)!) {
        const point = transform(sample.point, rotation, position);
        const normal = transform(sample.normal, rotation, zero());
        const relative = sub(velocity, body.velocityAtPoint(point)), speed = length(relative);
        if (speed < 1e-6) continue;
        const direction = mul(relative, 1 / speed), incidence = -dot(normal, direction);
        if (incidence <= 1e-6) continue;
        const area = sample.area * incidence;
        const upstream = mul(direction, -1), origin = add(point, mul(upstream, .0001));
        const ray = new RAPIER.Ray(origin, upstream);
        const sheltered = blockers.blocker(ray, colliders[sample.piece], this.shelterHints.get(sample));
        if (sheltered) this.shelterHints.set(sample, sheltered); else this.shelterHints.delete(sample);
        if (sheltered) { load.shelteredArea += area; continue; }
        load.exposedArea += area;
        const force = mul(direction, .5 * AIR_DENSITY * DRAG_COEFFICIENT * speed * speed * area);
        load.force = add(load.force, force);
        load.torque = add(load.torque, cross(sub(point, center), force));
        applied.push({ id, point, force });
      }
    }
    return applied;
  }
  apply() {
    // Impulses integrate F * dt exactly once; persistent body forces are untouched.
    for (const { id, point, force } of this.measure()) this.sim.body(id).applyImpulseAtPoint(mul(force, this.sim.dt), point, true);
  }
  record() {
    return { model: 'sampled-surface-drag-v1', settings: this.settings, airDensityKgM3: AIR_DENSITY,
      dragCoefficient: DRAG_COEFFICIENT, samplesPerQuad: 4, samplesPerTriangle: 3, shelterRayLengthM: 100,
      events: this.events, loads: Object.fromEntries(this.loads) };
  }
}
