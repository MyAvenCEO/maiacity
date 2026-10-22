import RAPIER from '@dimforge/rapier3d-compat';
import {polyVolume, type Polyhedron} from './geometry';

export type V3 = { x: number; y: number; z: number };
export type Quaternion = V3 & { w: number };
export type Box = {
  id: string; size: [number, number, number]; position: V3; angle?: number;
  rotation?: Quaternion;
  /** Flat bottom with a planar top rising from -Z to +Z. size is its bounding box. */
  taper?: { backHeight: number; frontHeight: number };
  waterBarrier?: boolean;
  polyhedron?: Polyhedron;
  /** Disjoint convex regions of one supplied panel, preserving real cutouts. */
  convexPieces?: Polyhedron[];
  opacity?: number;
  /** Densities in shapesOf order for a prefabricated mixed-material assembly. */
  shapeDensities?: number[];
  /** Display-only subdivision of the same solid, e.g. individual bricks and mortar joints that together
   * fill exactly the collision pieces. Physics, mass and wind use the collision pieces only. */
  renderPieces?: { size: [number, number, number]; offset: V3; rotation?: Quaternion; color: number }[];
  telescopic?: {model:string;heightM:number;minHeightM:number;maxHeightM:number;overlapM:number;segmentLengthM:number;segments:number;operation:string;assetId?:string};
  mountPoint?: {standard:string;position:V3;normal:V3;orientation:Quaternion;faceSizeM:[number,number];boltPatternM:[number,number];uses:string[];note:string};
  prefab?: { components: Box[]; fastenings: {a:string;b:string;description:string}[] };
  pieces?: { size: [number, number, number]; offset: V3; rotation?: Quaternion }[];
  density: number; material: string; fixed?: boolean; friction: number; color: number;
};
export const polyhedraOf=(box:Box):Polyhedron[]=>[...(box.polyhedron?[box.polyhedron]:[]),...(box.convexPieces??[])];
export const piecesOf = (box: Box): {size:Box['size'];offset:V3;rotation?:Quaternion}[] => box.pieces ?? ((box.polyhedron||box.convexPieces) ? [] : [{ size: box.size, offset: { x: 0, y: 0, z: 0 } }]);
export const volumeOf = (box: Box) => polyhedraOf(box).length ? polyhedraOf(box).reduce((sum,p)=>sum+polyVolume(p),0) + piecesOf(box).reduce((s,p)=>s+p.size[0]*p.size[1]*p.size[2],0) : box.taper
  ? box.size[0] * box.size[2] * (box.taper.backHeight + box.taper.frontHeight) / 2
  : piecesOf(box).reduce((sum, p) => sum + p.size[0] * p.size[1] * p.size[2], 0);
export const rotationOf = (box: Box): Quaternion => box.rotation ?? { x: 0, y: 0, z: Math.sin((box.angle ?? 0) / 2), w: Math.cos((box.angle ?? 0) / 2) };
export const inverseRotation = (q: Quaternion): Quaternion => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export function multiplyRotations(a: Quaternion, b: Quaternion): Quaternion {
  return { x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z };
}
export function shapeVerticesOf(box: Box): V3[][] {
  const groups:V3[][]=polyhedraOf(box).map(p=>p.vertices);
  for (const p of piecesOf(box)) {
    const vertices:V3[]=[];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const height = box.taper && y === 1 ? (z === -1 ? box.taper.backHeight : box.taper.frontHeight) : 0;
      vertices.push(transform({x:x*p.size[0]/2,y:box.taper ? -p.size[1]/2+height : y*p.size[1]/2,z:z*p.size[2]/2},p.rotation??{x:0,y:0,z:0,w:1},p.offset));
    }
    groups.push(vertices);
  }
  return groups;
}
export const verticesOf=(box:Box)=>shapeVerticesOf(box).flat();
export function surfaceFacesOf(box:Box): {vertices:V3[];piece:number}[] {
 const indices=[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]];
 const polys=polyhedraOf(box);
 return shapeVerticesOf(box).flatMap((vertices,piece)=>(polys[piece]?.faces??indices).map(face=>({vertices:face.map(i=>vertices[i]),piece})));
}
export const facesOf=(box:Box)=>surfaceFacesOf(box).map(f=>f.vertices);
export function shapesOf(box: Box): { shape: RAPIER.Shape; offset: V3; rotation?:Quaternion; volume?:number }[] {
 const shapes:{shape:RAPIER.Shape;offset:V3;rotation?:Quaternion;volume?:number}[]=[];
 for(const poly of polyhedraOf(box))shapes.push({shape:new RAPIER.ConvexPolyhedron(new Float32Array(poly.vertices.flatMap(p=>[p.x,p.y,p.z])),new Uint32Array(poly.faces.flatMap(face=>face.slice(1,-1).flatMap((_,i)=>[face[0],face[i+1],face[i+2]])))),offset:{x:0,y:0,z:0},volume:polyVolume(poly)});
 if(box.taper)shapes.push({shape:new RAPIER.ConvexPolyhedron(new Float32Array(verticesOf(box).flatMap(p=>[p.x,p.y,p.z]))),offset:{x:0,y:0,z:0}});
 else for(const p of piecesOf(box))shapes.push({shape:new RAPIER.Cuboid(...p.size.map(n=>n/2) as [number,number,number]),offset:p.offset,rotation:p.rotation});
 return shapes;
}
export type Scenario = { id: string; title: string; question: string; boxes: Box[] };
export const DT = 1 / 120;
export const G = 9.81;
export const initialize = () => RAPIER.init();
const v = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
const box = (id: string, size: Box['size'], position: V3, density = 600, color = 0xc68d51): Box =>
  ({ id, size, position, density, material: density === 600 ? 'Wood (rigid)' : 'Concrete (rigid)', friction: .6, color });
const ground = (): Box => ({ ...box('ground', [30, .4, 16], v(0, -.2), 2000, 0x64756c), fixed: true, material: 'Fixed boundary' });
const board = (x = 0, y = .64) => box('board', [2.4, .08, .3], v(x, y));
const supports = () => [-.8, .8].map((x, i) => box(`support-${i + 1}`, [.35, .6, .6], v(x, .3), 2000, 0xaab3ad));
const supported = (offset = 0, load = false): Box[] => [ground(), ...supports(), board(offset),
  ...(load ? [box('load', [.3, .3, .3], v(.15, .83), 2000, 0x68978d)] : [])];
function incline(friction: number): Box[] {
  const a = Math.PI / 9;
  return [
    { ...ground(), position: v(0, -2.2) },
    { ...box('incline', [12, .2, 3], v(0, 2), 2000, 0x85968b), fixed: true, angle: a, friction },
    { ...box('board', [1, .12, .5], v(-Math.sin(a) * .16, 2 + Math.cos(a) * .16)), angle: a, friction },
  ];
}
export function scenarios(): Scenario[] {
  return [
    { id: 'supported', title: '01 / Two supports', question: 'Can contact alone carry a board into the ground?', boxes: supported(.03) },
    { id: 'loaded', title: '02 / Separate load', question: 'Where does the extra 54 kg go through the contacts?', boxes: supported(.03, true) },
    { id: 'freefall', title: '03 / Free fall', question: 'Does the board follow gravity before it hits the ground?', boxes: [ground(), board(0, 5)] },
    { id: 'ground', title: '04 / Ground contact', question: 'Does a dropped board settle without tunnelling or drift?', boxes: [ground(), board(0, .5)] },
    { id: 'tip-right', title: '05 / Beyond the right support', question: 'Does unsupported weight rotate the board clockwise?', boxes: supported(1.3) },
    { id: 'tip-left', title: '06 / Beyond the left support', question: 'Does the mirrored arrangement tip the other way?', boxes: supported(-1.3) },
    { id: 'incline-slip', title: '07 / Slippery incline', question: 'At 20°, does friction 0.1 allow the board to slide?', boxes: incline(.1) },
    { id: 'incline-grip', title: '08 / Grippy incline', question: 'At 20°, does friction 0.8 keep the board at rest?', boxes: incline(.8) },
    { id: 'unconnected', title: '09 / Touching is not joining', question: 'Do touching pieces separate when gravity removes their contact?', boxes: [...supported(), box('neighbor', [.4, .4, .3], v(1.4, .84), 600)] },
  ];
}
export type Contact = { a: string; b: string; point: V3; normal: V3; force: number; distance: number };
export class Simulation {
  readonly world: RAPIER.World;
  readonly parts = new Map<string, { spec: Box; body: RAPIER.RigidBody; collider: RAPIER.Collider; colliders: RAPIER.Collider[] }>();
  ticks = 0;
  beforeStep?: () => void;
  afterStep?: () => void;
  environmentStep?: () => void;
  contactFilter?: (bodyA: number, bodyB: number) => boolean;
  private events?: RAPIER.EventQueue;
  private readonly hooks: RAPIER.PhysicsHooks = {
    filterContactPair: (_a, _b, bodyA, bodyB) => this.contactFilter?.(bodyA, bodyB) === false ? null : RAPIER.SolverFlags.COMPUTE_IMPULSE,
    filterIntersectionPair: () => true,
  };
  constructor(readonly scenario: Scenario, readonly dt = DT) {
    this.world = new RAPIER.World(v(0, -G));
    this.world.timestep = dt;
    this.world.numSolverIterations = 12;
    for (const spec of scenario.boxes) this.addPart(spec);
  }
  addPart(spec: Box) {
      if (this.parts.has(spec.id)) throw new Error(`Duplicate part: ${spec.id}`);
      const d = (spec.fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
        .setTranslation(spec.position.x, spec.position.y, spec.position.z)
        .setRotation(rotationOf(spec))
        .setCanSleep(false).setCcdEnabled(!spec.fixed);
      const body = this.world.createRigidBody(d);
      const colliders = shapesOf(spec).map((piece, index) => {
        const desc=new RAPIER.ColliderDesc(piece.shape)
        .setTranslation(piece.offset.x, piece.offset.y, piece.offset.z)
        .setRotation(piece.rotation ?? {x:0,y:0,z:0,w:1})
        .setFriction(spec.friction).setRestitution(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setActiveHooks(this.contactFilter ? RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS : RAPIER.ActiveHooks.NONE);
        // Preserve authored density × volume; convex-mesh cooking can otherwise
        // lose mass at narrow facets. Inertia still follows the collision shape.
        const density=spec.shapeDensities?.[index]??spec.density;
        if(piece.volume===undefined)desc.setDensity(density);else desc.setMass(piece.volume*density);
        return this.world.createCollider(desc,body);
      });
      this.parts.set(spec.id, { spec, body, collider: colliders[0], colliders });
      return body;
  }
  removePart(id: string) {
    const part=this.parts.get(id);if(!part)return;
    this.world.removeRigidBody(part.body);this.parts.delete(id);
  }
  get time() { return this.ticks * this.dt; }
  step(count = 1) { for (let i = 0; i < count; i++) { this.beforeStep?.(); this.environmentStep?.(); this.world.step(this.contactFilter ? (this.events ??= new RAPIER.EventQueue(true)) : undefined, this.contactFilter ? this.hooks : undefined); this.ticks++; this.afterStep?.(); } }
  run(seconds: number) { this.step(Math.round(seconds / this.dt)); }
  body(id: string) { return this.parts.get(id)!.body; }
  get mass() { return [...this.parts.values()].reduce((sum, p) => sum + (p.spec.fixed ? 0 : p.body.mass()), 0); }
  contacts(): Contact[] {
    const contacts: Contact[] = [];
    const owners = new Map<number, { id: string; order: number }>();
    [...this.parts.values()].forEach((part, order) => part.colliders.forEach(c => owners.set(c.handle, { id: part.spec.id, order })));
    for (const first of this.parts.values()) for (const colliderA of first.colliders) {
      const ownerA = owners.get(colliderA.handle)!;
      // Ask the broad phase for actual neighboring colliders instead of querying
      // every possible pair in a building containing hundreds of separate parts.
      this.world.contactPairsWith(colliderA, colliderB => {
        const ownerB = owners.get(colliderB.handle);
        if (!ownerB || ownerA.order >= ownerB.order) return;
        this.world.contactPair(colliderA, colliderB, (m, flipped) => {
          for (let i = 0; i < m.numContacts(); i++) {
            const distance = m.contactDist(i), impulse = m.contactImpulse(i);
            if (distance > .002 && impulse <= 0) continue;
            const local = m.localContactPoint1(i);
            if (!local) continue;
            const source = flipped ? colliderB : colliderA;
            const point = transform(local, source.rotation(), source.translation());
            contacts.push({ a: ownerA.id, b: ownerB.id, point, normal: m.normal(), force: impulse / this.dt, distance });
          }
        });
      });
    }
    return contacts;
  }
  state() {
    return [...this.parts.values()].map(({ spec, body }) => ({
      id: spec.id, mass: body.mass(), position: { ...body.translation() }, rotation: { ...body.rotation() },
      velocity: { ...body.linvel() }, angularVelocity: { ...body.angvel() },
    }));
  }
  dispose() { this.events?.free(); this.world.free(); }
}
export function transform(p: V3, q: { x: number; y: number; z: number; w: number }, t: V3): V3 {
  const ux = 2 * (q.y * p.z - q.z * p.y), uy = 2 * (q.z * p.x - q.x * p.z), uz = 2 * (q.x * p.y - q.y * p.x);
  return { x: p.x + q.w * ux + q.y * uz - q.z * uy + t.x, y: p.y + q.w * uy + q.z * ux - q.x * uz + t.y, z: p.z + q.w * uz + q.x * uy - q.y * ux + t.z };
}
export function boundsY(sim: Simulation, id: string) {
  const { spec, body } = sim.parts.get(id)!;
  const ys: number[] = [];
  for (const vertex of verticesOf(spec)) ys.push(transform(vertex, body.rotation(), body.translation()).y);
  return { min: Math.min(...ys), max: Math.max(...ys) };
}
// Wall time only chooses how many identical fixed steps to take. Backlog is retained.
export class Playback {
  running = false;
  speed = 1;
  private pending = 0;
  get pendingSeconds() { return this.pending; }
  constructor(readonly sim: Simulation) {}
  advance(elapsed: number, maxSteps = 240) {
    if (!this.running) return;
    this.pending += elapsed * this.speed;
    let count = Math.min(maxSteps, Math.floor((this.pending + 1e-10) / this.sim.dt));
    this.pending -= count * this.sim.dt;
    this.sim.step(count);
  }
}
