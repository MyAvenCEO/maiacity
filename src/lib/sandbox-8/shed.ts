import RAPIER from '@dimforge/rapier3d-compat';
import {sub,add,mean,unit,cross,dot,fitRigidRotation} from './geometry';
import { FastenerGroup, fasteningPatch, WOOD_FASTENER, FELT_BOND, type FastenerProfile, type FastenerReading } from './fasteners';
import { Simulation, transform, volumeOf, verticesOf, rotationOf, inverseRotation, multiplyRotations, shapesOf, piecesOf, type Box, type Scenario, type V3 } from './simulation';

export const STAGES = ['Bottom frame', 'Floor', 'Wall frame', 'Wall boards', 'Top frame', 'Roof supports', 'Roof boards', 'Roofing felt'] as const;
export const ROOF_PITCH = 5 * Math.PI / 180;
const roofRotation = { x: -Math.sin(ROOF_PITCH / 2), y: 0, z: 0, w: Math.cos(ROOF_PITCH / 2) };
/** Deck underside: higher at the doorway (+Z), lower at the back (-Z). */
export const roofUndersideY = (z: number) => 2.56 + (z + 1.17) * Math.tan(ROOF_PITCH);
export type BuildPart = { fitToAttachments?: boolean; placementReference?: string; placementEnds?: { targets: [string,string]; points: [V3,V3] }; box: Box; stage: number; connectTo: string[]; fastening?: Connection['fastening']; structural?: boolean; profile?: FastenerProfile };
export type BuildDefinition = { experimentParameters?:Record<string,string|number>; removeWithdrawnShoring?: boolean; shoringReleaseAfter?: {afterPart:string;parts:string[]}[]; parameters?: {diameterM:number;frequency?:number;timberSectionsMm?:number[];targetCellSizeM?:number}; shoringStorageX?: number; plan: BuildPart[]; stages: readonly string[]; rootId: string; interval: number; solverIterations?: number; internalPgsIterations?: number; temporaryProps?: string[]; withdrawShoringAfterStage?: number; temporarySupportGroups?: string[][]; placementGroups?: string[][]; filterRigidInternalContacts?: boolean; contactNaturalFrequency?: number; allowedLinearError?: number; name: string; note: string };
export type Connection = { id: string; a: string; b: string; anchorA: V3; anchorB: V3; fastening: 'ideal-fixed' | 'assembly-clamp' | 'post-to-rail-screw-group' | 'shoe-to-frame-screw-group' | 'post-to-shoe-bolt-group' | 'felt-bond' | 'mortar-bond' | 'masonry-anchor'; joint?: RAPIER.ImpulseJoint; grip?: FastenerGroup };
export type FailureEvent = { tick: number; connection: string; a: string; b: string; point: number; material: string; reading: FastenerReading };
export type BuildEvent = { tick: number; action: 'place-and-fasten' | 'release' | 'connection-failure' | 'withdraw-shoring' | 'adjust-stand' | 'test-impulse'; part: string; massInKg: number; massOutKg?: number; assetId?:string; heightM?:number; reused?:boolean; impulse?:V3; connections: string[]; placement?: {position:V3;rotation:ReturnType<typeof rotationOf>} };
const xyz = (x: number, y: number, z: number): V3 => ({ x, y, z });

export function shedScenario(): Scenario {
  return { id: 'shed', title: '10 / Build a wooden shed', question: 'A wooden shed with a felt-covered roof falling 5° toward the back, away from the doorway.', boxes: [
    { id: 'ground', size: [30, .4, 16], position: xyz(0, -.2, 0), fixed: true, density: 2000, material: 'Fixed boundary', friction: .6, color: 0x64756c },
  ] };
}

// This is a construction recipe, not automatic joining by proximity. Every target
// is declared here; touching any other piece never creates a connection.
export function shedPlan(): BuildPart[] {
  const parts: BuildPart[] = [];
  const add = (id: string, stage: number, size: Box['size'], position: V3, connectTo: string[] = []) => {
    parts.push({ stage, connectTo, box: { id, size, position, density: 600, material: 'Wood (rigid)', friction: .6,
      color: [0x987044, 0xd4ab73, 0xb58350, 0xc5a075, 0x987044, 0xa77b49, 0xb98c57, 0x353b3b][stage] } });
  };
  add('base-left', 0, [.12, .15, 2.16], xyz(-1.44, .075, 0));
  add('base-back', 0, [2.76, .15, .12], xyz(0, .075, -1.14));
  add('base-right', 0, [.12, .15, 2.16], xyz(1.44, .075, 0));
  add('base-front', 0, [2.76, .15, .12], xyz(0, .075, 1.14));
  for (const [i, z] of [-.6, 0, .6].entries()) add(`floor-joist-${i + 1}`, 0, [2.76, .15, .1], xyz(0, .075, z), ['base-left', 'base-right']);
  for (let i = 0; i < 8; i++) {
    add(`floor-board-${i + 1}`, 1, [3, .04, .296], xyz(0, .17, -1.05 + i * .3), ['base-left', 'base-right']);
    if (i === 0 || i === 7) {
      // A single supplied notched board, represented by three disjoint cuboids.
      // The two 120 mm wide corner cutouts leave the post sockets unobstructed.
      parts.at(-1)!.box.pieces = [
        { size: [2.76, .04, .296], offset: xyz(0, 0, 0) },
        ...[-1.44, 1.44].map(x => ({ size: [.12, .04, .178] as [number, number, number], offset: xyz(x, 0, i === 0 ? .059 : -.059) })),
      ];
      if (i === 7) {
        // Two open-front cutouts expose the rail for the steel shoe bases.
        parts.at(-1)!.box.pieces = [
          { size: [2.76, .04, .178], offset: xyz(0, 0, -.059) },
          ...[[-1.38, -.516], [-.404, .404], [.516, 1.38]].map(([lo, hi]) => ({ size: [hi - lo, .04, .118] as Box['size'], offset: xyz((lo + hi) / 2, 0, .089) })),
          ...[-1.44, 1.44].map(x => ({ size: [.12, .04, .178] as Box['size'], offset: xyz(x, 0, -.059) })),
        ];
      }
    }
  }
  for (const [side, x] of [['left', -1.44], ['right', 1.44]] as const) {
    for (const [end, z] of [['back', -1.14], ['front', 1.14]] as const)
      add(`post-${side}-${end}`, 2, [.12, 2.39, .12], xyz(x, 1.195, z), [`base-${side}`, `base-${end}`]);
  }
  for (const [side, x] of [['left', -.46], ['right', .46]] as const) {
    add(`door-shoe-${side}`, 2, [.112, .3, .12], xyz(x, .3, 1.14), ['base-front']);
    Object.assign(parts.at(-1)!.box, { density: 7850, material: 'Steel post shoe (rigid)', color: 0x78949f,
      pieces: [
        { size: [.112, .006, .12], offset: xyz(0, -.147, 0) },
        ...[-.053, .053].map(dx => ({ size: [.006, .294, .12], offset: xyz(dx, .003, 0) })),
      ] });
    // Seat directly on the shoe's plate; preserve the existing header height.
    add(`door-post-${side}`, 2, [.1, 2.234, .1], xyz(x, 1.273, 1.15), [`door-shoe-${side}`]);
  }
  add('door-header', 2, [.82, .2, .1], xyz(0, 2.29, 1.15), ['door-post-left', 'door-post-right']);
  for (let i = 0; i < 5; i++) {
    const y = .41 + i * .44;
    for (const [side, x] of [['left', -1.52], ['right', 1.52]] as const)
      add(`wall-${side}-${i + 1}`, 3, [.04, .436, 2.4], xyz(x, y, 0), [`post-${side}-back`, `post-${side}-front`]);
    add(`wall-back-${i + 1}`, 3, [3, .436, .04], xyz(0, y, -1.22), ['post-left-back', 'post-right-back']);
    for (const [side, x] of [['left', -.955], ['right', .955]] as const)
      add(`wall-front-${side}-${i + 1}`, 3, [1.09, .436, .04], xyz(x, y, 1.22), [`post-${side}-front`, `door-post-${side}`]);
  }
  add('wall-above-door', 3, [.82, .196, .04], xyz(0, 2.29, 1.22), ['door-header']);
  for (const [side, x] of [['left', -1.42], ['right', 1.42]] as const)
    add(`top-${side}`, 4, [.1, .15, 2.34], xyz(x, 2.465, 0), [`post-${side}-back`, `post-${side}-front`]);
  add('top-back', 4, [2.74, .15, .1], xyz(0, 2.465, -1.12), ['top-left', 'top-right']);
  add('top-front', 4, [2.74, .15, .1], xyz(0, 2.465, 1.12), ['top-left', 'top-right', 'door-post-left', 'door-post-right', 'door-header']);
  for (const [i, z] of [-.55, 0, .55].entries()) add(`roof-joist-${i + 1}`, 4, [2.74, .15, .1], xyz(0, 2.465, z), ['top-left', 'top-right']);
  // Supplied tapered firrings fill the space between the level frame and pitched
  // deck. Their rendered convex hulls and physical bearing faces are identical.
  for (const target of parts.filter(p => p.stage === 4).map(p => p.box)) {
    const [width, , depth] = target.size, { x, z } = target.position;
    const backHeight = roofUndersideY(z - depth / 2) - 2.54;
    const frontHeight = roofUndersideY(z + depth / 2) - 2.54;
    add(`firring-${target.id}`, 5, [width > 1 ? width - .02 : width, frontHeight, depth], xyz(x, 2.54 + frontHeight / 2, z), [target.id]);
    parts.at(-1)!.box.taper = { backHeight, frontHeight };
  }
  for (let i = 0; i < 10; i++) {
    const position = transform(xyz(0, .02, -1.215 + i * .27), roofRotation, xyz(0, roofUndersideY(0), 0));
    add(`roof-board-${i + 1}`, 6, [3.24, .04, .266], position, ['firring-top-left', 'firring-top-right']);
    parts.at(-1)!.box.rotation = roofRotation;
  }
  // One continuous supplied sheet, idealized as rigid and bonded to the deck.
  // Water impermeability is a material declaration, not a fluid simulation.
  add('roofing-felt', 7, [3.24, .004, 2.696], transform(xyz(0, .042, 0), roofRotation, xyz(0, roofUndersideY(0), 0)),
    Array.from({ length: 10 }, (_, i) => `roof-board-${i + 1}`));
  Object.assign(parts.at(-1)!.box, { rotation: roofRotation, density: 1000, material: 'Roofing felt (rigid sheet approximation)', waterBarrier: true, friction: .7 });
  return parts;
}

/** Find a point shared by the actual authored surfaces, including pitched faces. */
export function jointPoint(a: Box, b: Box, clearanceM=0): V3 {
  if (a.polyhedron || b.polyhedron || a.convexPieces || b.convexPieces) {
    const points = fasteningPatch(a,b,clearanceM).points;
    return points.reduce((sum,p)=>xyz(sum.x+p.x/points.length,sum.y+p.y/points.length,sum.z+p.z/points.length),xyz(0,0,0));
  }
  const rotatedPieces = (box: Box) => piecesOf(box).some(p => p.rotation);
  if (a.polyhedron || b.polyhedron || a.taper || b.taper || a.rotation || b.rotation || a.angle || b.angle || rotatedPieces(a) || rotatedPieces(b)) {
    for (const sa of shapesOf(a)) for (const sb of shapesOf(b)) {
      // Include each shape's own rotation inside its part (rotated box pieces).
      const ra = multiplyRotations(rotationOf(a), sa.rotation ?? { x: 0, y: 0, z: 0, w: 1 }), rb = multiplyRotations(rotationOf(b), sb.rotation ?? { x: 0, y: 0, z: 0, w: 1 });
      const contact = sa.shape.contactShape(transform(sa.offset, rotationOf(a), a.position), ra,
        sb.shape, transform(sb.offset, rotationOf(b), b.position), rb, .00001);
      if (contact && Math.abs(contact.distance) <= .00001)
        return xyz((contact.point1.x + contact.point2.x) / 2, (contact.point1.y + contact.point2.y) / 2, (contact.point1.z + contact.point2.z) / 2);
    }
    throw Error(`Planned connection does not touch: ${a.id} / ${b.id}`);
  }
  let best: V3 | undefined, largestArea = -1;
  for (const pa of piecesOf(a)) for (const pb of piecesOf(b)) {
    const point = xyz(0, 0, 0), overlaps: number[] = [];
    for (const [i, axis] of (['x', 'y', 'z'] as const).entries()) {
      const ca = a.position[axis] + pa.offset[axis], cb = b.position[axis] + pb.offset[axis];
      const lo = Math.max(ca - pa.size[i] / 2, cb - pb.size[i] / 2);
      const hi = Math.min(ca + pa.size[i] / 2, cb + pb.size[i] / 2);
      overlaps.push(hi - lo); point[axis] = (lo + hi) / 2;
    }
    if (overlaps.some(n => n < -.00001) || overlaps.every(n => n > .00001)) continue;
    const [x, y, z] = overlaps.map(n => Math.max(0, n));
    const area = x * y + y * z + x * z;
    if (area > largestArea) { largestArea = area; best = point; }
  }
  if (!best) throw Error(`Planned connection does not touch: ${a.id} / ${b.id}`);
  return best;
}
const relative = (point: V3, origin: V3): V3 => xyz(point.x - origin.x, point.y - origin.y, point.z - origin.z);

export class ShedBuild {
  readonly plan: BuildPart[];
  readonly stages: readonly string[];
  readonly connectionHistory = new Map<string, Connection>();
  readonly connections = new Map<string, Connection>();
  readonly events: BuildEvent[] = [];
  readonly standInventory: {id:string;available:boolean;uses:number;heightM:number;massKg:number}[] = [];
  readonly failures: FailureEvent[] = [];
  readonly failedConnections = new Map<string, Connection>();
  count = 0;
  suppliedMass = 0;
  withdrawnMass = 0;
  readonly withdrawnParts = new Set<string>();
  altered = false;
  autoUntil = 0;
  private nextTick = 0;
  private rigidComponents = new Map<number, number>();
  constructor(readonly sim: Simulation, readonly definition?: BuildDefinition, readonly breakableRoof = true) {
    this.plan = definition?.plan ?? shedPlan();
    this.stages = definition?.stages ?? STAGES;
    if (definition?.filterRigidInternalContacts) sim.contactFilter = (a, b) =>
      !this.rigidComponents.has(a) || !this.rigidComponents.has(b) || this.rigidComponents.get(a) !== this.rigidComponents.get(b);
    sim.world.numSolverIterations = definition?.solverIterations ?? 8;
    sim.world.integrationParameters.numInternalPgsIterations = definition?.internalPgsIterations ?? 12;
    if (definition?.contactNaturalFrequency !== undefined) sim.world.integrationParameters.contact_natural_frequency = definition.contactNaturalFrequency;
    if (definition?.allowedLinearError !== undefined) sim.world.integrationParameters.normalizedAllowedLinearError = definition.allowedLinearError;
    sim.afterStep = () => this.checkFasteners();
    sim.beforeStep = () => {
      if (this.count < this.autoUntil && sim.ticks >= this.nextTick) {
        this.placeNext(); this.nextTick = sim.ticks + Math.max(1, Math.round((definition?.interval ?? .4) / sim.dt));
      }
    };
  }
  get next() { return this.plan[this.count]; }
  get complete() { return this.count === this.plan.length; }
  get automatic() { return this.count < this.autoUntil; }
  start(mode: 'stage' | 'all') {
    if (this.altered || this.complete) return;
    this.autoUntil = mode === 'all' ? this.plan.length : this.plan.findIndex((p, i) => i > this.count && p.stage !== this.next.stage);
    if (this.autoUntil < 0) this.autoUntil = this.plan.length;
    this.nextTick = this.sim.ticks;
  }
  stop() { this.autoUntil = 0; }
  placement(spec: Box, reference?: string) {
    const root = this.sim.parts.get(reference ?? this.definition?.rootId ?? 'base-left');
    const delta=root?multiplyRotations(root.body.rotation(),inverseRotation(rotationOf(root.spec))):undefined;
    return root ? { position: transform(relative(spec.position, root.spec.position), delta!, root.body.translation()), rotation: multiplyRotations(delta!, rotationOf(spec)) }
      : { position: spec.position, rotation: rotationOf(spec) };
  }
  get nextPlacementIds() { return this.definition?.placementGroups?.find(g=>g[0]===this.next?.box.id) ?? (this.next?[this.next.box.id]:[]); }
  placeNext() {
    if (this.altered || this.complete) return false;
    const ids=this.nextPlacementIds;
    // Prefabricated units arrive in one operation. Their constituent bodies and
    // finite internal connections remain inspectable; no solver tick runs between them.
    for(const id of ids){if(this.next?.box.id!==id)throw Error(`Non-contiguous placement group: ${id}`);this.placePart();}
    return true;
  }
  private placePart() {
    if (this.altered || this.complete) return false;
    const entry = this.next, spec = structuredClone(entry.box);
    // Insertion is an explicit external laboratory placement and material inflow.
    // Existing bodies are never rebuilt or reset between construction steps.
    let pose = this.placement(spec, entry.placementReference);
    if(entry.placementEnds){
      // Fit a supplied rigid strut to the current connector positions. Do not
      // teleport either existing connector back to its planned location.
      const ends=entry.placementEnds,actual=ends.points.map((point,i)=>{
        const target=this.sim.parts.get(ends.targets[i])!;
        return transform(transform(sub(point,target.spec.position),inverseRotation(rotationOf(target.spec)),xyz(0,0,0)),target.body.rotation(),target.body.translation());
      });
      const a=unit(sub(ends.points[1],ends.points[0])),b=unit(sub(actual[1],actual[0])),axis=cross(a,b),w=1+dot(a,b);
      const norm=Math.hypot(axis.x,axis.y,axis.z,w);
      const delta=norm>1e-8?{x:axis.x/norm,y:axis.y/norm,z:axis.z/norm,w:w/norm}:rotationOf(spec);
      pose={position:add(mean(actual),transform(sub(spec.position,mean(ends.points)),delta,xyz(0,0,0))),rotation:multiplyRotations(delta,rotationOf(spec))};
    }
    if(entry.fitToAttachments&&entry.connectTo.length){
      // Fit the supplied rigid panel to the current bracket poses. Fitting
      // the attachment locations reduces installation preload without stretching
      // the panel or moving any existing structure.
      const targets=entry.connectTo.map(id=>this.sim.parts.get(id)!);
      const planned=targets.map(p=>mean(fasteningPatch(spec,p.spec,entry.profile?.clearanceM).points));
      const actual=planned.map((point,i)=>transform(transform(sub(point,targets[i].spec.position),inverseRotation(rotationOf(targets[i].spec)),xyz(0,0,0)),targets[i].body.rotation(),targets[i].body.translation()));
      const delta=fitRigidRotation(planned,actual);
      pose={position:add(mean(actual),transform(sub(spec.position,mean(planned)),delta,xyz(0,0,0))),rotation:multiplyRotations(delta,rotationOf(spec))};
    }
    if(spec.telescopic){
      let asset=this.standInventory.find(a=>a.available);
      const reused=!!asset;
      if(!asset){asset={id:`TS-${this.standInventory.length+1}`,available:true,uses:0,heightM:spec.telescopic.minHeightM,massKg:volumeOf(spec)*spec.density};this.standInventory.push(asset);}
      asset.available=false;asset.uses++;asset.heightM=spec.telescopic.heightM;spec.telescopic.assetId=asset.id;
      this.events.push({tick:this.sim.ticks,action:'adjust-stand',part:spec.id,assetId:asset.id,heightM:asset.heightM,reused,massInKg:0,connections:[]});
    }
    const body = this.sim.addPart(spec);
    body.setTranslation(pose.position, true); body.setRotation(pose.rotation, true);
    const installed: string[] = [];
    for (const target of entry.connectTo) {
      const other = this.sim.parts.get(target)!;
      const point = jointPoint(spec, other.spec,entry.profile?.clearanceM);
      const frameA = inverseRotation(rotationOf(spec)), frameB = inverseRotation(rotationOf(other.spec));
      const anchorA = transform(relative(point, spec.position), frameA, xyz(0, 0, 0));
      const anchorB = transform(relative(point, other.spec.position), frameB, xyz(0, 0, 0));
      const wood = spec.material.startsWith('Wood') || other.spec.material.startsWith('Wood');
      const finite = this.breakableRoof && (!!entry.profile || ((this.definition !== undefined || entry.stage >= 4) && wood));
      const grip = finite ? new FastenerGroup(this.sim, spec.id, target, entry.profile ?? (spec.waterBarrier ? FELT_BOND : WOOD_FASTENER)) : undefined;
      const joint = grip ? undefined : this.sim.world.createImpulseJoint(RAPIER.JointData.fixed(anchorA, frameA, anchorB, frameB), body, other.body, true);
      joint?.setContactsEnabled(false);
      const id = `${spec.id}/${target}`;
      const fastening: Connection['fastening'] = entry.fastening ?? (spec.waterBarrier ? 'felt-bond'
        : spec.id.startsWith('door-shoe-') ? 'shoe-to-frame-screw-group'
        : spec.id.startsWith('door-post-') && target.startsWith('door-shoe-') ? 'post-to-shoe-bolt-group'
        : spec.id.startsWith('post-') && target.startsWith('base-') ? 'post-to-rail-screw-group' : 'ideal-fixed');
      this.connections.set(id, { id, a: spec.id, b: target, anchorA, anchorB, joint, grip, fastening }); this.connectionHistory.set(id, this.connections.get(id)!); installed.push(id);
    }
    const mass = spec.density * volumeOf(spec);
    this.suppliedMass += mass;
    this.events.push({ tick: this.sim.ticks, action: 'place-and-fasten', part: spec.id, massInKg: mass, connections: installed });
    this.count++;
    const releases=this.definition?.shoringReleaseAfter?.filter(rule=>rule.afterPart===spec.id).flatMap(rule=>rule.parts)??[];
    if(releases.length)this.withdrawShoring(releases);
    if(this.definition?.withdrawShoringAfterStage===entry.stage&&this.next?.stage!==entry.stage) this.withdrawShoring();
    else if(this.complete&&this.definition?.withdrawShoringAfterStage===undefined) this.withdrawShoring();
    this.refreshRigidComponents();
    return true;
  }
  private withdrawShoring(ids=this.definition?.temporaryProps??[]) {
    const root=this.sim.parts.get(this.definition?.rootId ?? 'base-left');
    if(!root)return;
    const groups=this.definition?.temporarySupportGroups;
    for(const [i,id] of ids.entries()) {
      if(this.withdrawnParts.has(id)||!this.sim.parts.has(id))continue;
      this.withdrawnParts.add(id);
      const groupIndex=groups?.findIndex(g=>g.includes(id))??-1, group=groups?.[groupIndex];
      const removed:string[]=[];
      for(const [key,c] of this.connections)if((c.a===id||c.b===id)&&!(group?.includes(c.a)&&group.includes(c.b))){if(c.grip)c.grip.remove();else this.sim.world.removeImpulseJoint(c.joint!,true);this.connections.delete(key);removed.push(key);}
      if(this.definition?.removeWithdrawnShoring){
        const mass=this.sim.body(id).mass();this.withdrawnMass+=mass;
        const assetId=this.sim.parts.get(id)!.spec.telescopic?.assetId;
        const asset=this.standInventory.find(a=>a.id===assetId);if(asset)asset.available=true;
        this.sim.removePart(id);
        this.events.push({tick:this.sim.ticks,action:'withdraw-shoring',part:id,assetId,massInKg:0,massOutKg:mass,connections:removed});
        continue;
      }
      const body=this.sim.body(id), turn={x:0,y:0,z:Math.sin(Math.PI/4),w:Math.cos(Math.PI/4)};
      const minY=Math.min(...verticesOf(this.sim.parts.get(id)!.spec).map(p=>transform(p,turn,xyz(0,0,0)).y));
      const base=group?this.sim.parts.get(group[0])!.spec:undefined;
      const storageColumns=Math.max(4,Math.ceil(Math.sqrt(groups?.length??0)));
      const local=base?{x:(this.definition?.shoringStorageX??7)+(groupIndex%storageColumns)*1.5+this.sim.parts.get(id)!.spec.position.x-base.position.x,y:this.sim.parts.get(id)!.spec.position.y-.199,z:-2+(Math.floor(groupIndex/storageColumns)-(storageColumns-4)/2)*1.5+this.sim.parts.get(id)!.spec.position.z-base.position.z}:xyz(7,-minY+.001,-2+i*.25);
      const position=transform(relative(local,root.spec.position),root.body.rotation(),root.body.translation());
      const rotation=multiplyRotations(root.body.rotation(),group?rotationOf(this.sim.parts.get(id)!.spec):{x:0,y:0,z:Math.sin(Math.PI/4),w:Math.cos(Math.PI/4)});
      body.setTranslation(position,true);body.setRotation(rotation,true);body.setLinvel(xyz(0,0,0),true);body.setAngvel(xyz(0,0,0),true);
      this.events.push({tick:this.sim.ticks,action:'withdraw-shoring',part:id,massInKg:0,connections:removed,placement:{position,rotation}});
    }
  }
  release(part: string) {
    const removed: string[] = [];
    for (const [id, connection] of this.connections) {
      if (connection.a !== part && connection.b !== part) continue;
      if (connection.grip) connection.grip.remove(); else this.sim.world.removeImpulseJoint(connection.joint!, true); this.connections.delete(id); removed.push(id);
    }
    if (removed.length) {
      this.refreshRigidComponents();
      this.stop(); this.altered = true;
      this.events.push({ tick: this.sim.ticks, action: 'release', part, massInKg: 0, connections: removed });
    }
    return removed.length;
  }
  private checkFasteners() {
    let changed = false;
    for (const [id, c] of this.connections) {
      if (!c.grip) continue;
      for (const point of c.grip.failOverloaded()) {
        this.failures.push({ tick: this.sim.ticks, connection: id, a: c.a, b: c.b, point,
          material: c.grip.profile.name, reading: { ...c.grip.points[point].reading } });
        this.events.push({ tick: this.sim.ticks, action: 'connection-failure', part: c.a, massInKg: 0, connections: [id] });
        changed = true;
      }
      if (!c.grip.intact) { this.connections.delete(id); this.failedConnections.set(id, c); }
    }
    if (changed) { this.stop(); this.altered = true; this.refreshRigidComponents(); }
  }
  private refreshRigidComponents() {
    if (!this.definition?.filterRigidInternalContacts) return;
    const parents = new Map<number, number>();
    const find = (n: number): number => {
      const parent = parents.get(n);
      if (parent === undefined) { parents.set(n, n); return n; }
      if (parent === n) return n;
      const root = find(parent); parents.set(n, root); return root;
    };
    // Only permanent fixed bonds remove all relative degrees of freedom.
    // Internal contacts would redundantly fight those same constraints. This
    // filter neither adds connections nor suppresses contact across a release.
    for (const c of this.connections.values()) if (!c.grip) parents.set(find(this.sim.body(c.a).handle), find(this.sim.body(c.b).handle));
    this.rigidComponents.clear();
    for (const { body, colliders } of this.sim.parts.values()) {
      this.rigidComponents.set(body.handle, find(body.handle));
      for (const collider of colliders) collider.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    }
  }
  maxAnchorError() {
    let max = 0;
    for (const c of this.connections.values()) {
      const a = this.sim.body(c.a), b = this.sim.body(c.b);
      const pa = transform(c.anchorA, a.rotation(), a.translation()), pb = transform(c.anchorB, b.rotation(), b.translation());
      max = Math.max(max, Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z));
    }
    return max;
  }
  record() {
    return { experimentParameters:this.definition?.experimentParameters, standInventory:this.standInventory, withdrawnMassKg:this.withdrawnMass, withdrawnParts:[...this.withdrawnParts], removeWithdrawnShoring:this.definition?.removeWithdrawnShoring??false, shoringReleaseAfter:this.definition?.shoringReleaseAfter, parameters: this.definition?.parameters, plan: this.plan, temporaryProps: this.definition?.temporaryProps, temporarySupportGroups: this.definition?.temporarySupportGroups, placementGroups: this.definition?.placementGroups, breakableRoof: this.breakableRoof, failures: this.failures, failedConnections: [...this.failedConnections.values()].map(c => ({ id: c.id, a: c.a, b: c.b, grip: c.grip?.record() })), filterRigidInternalContacts: this.definition?.filterRigidInternalContacts ?? false, contactNaturalFrequency: this.definition?.contactNaturalFrequency, allowedLinearError: this.sim.world.integrationParameters.normalizedAllowedLinearError, timestep: this.sim.dt, solverIterations: this.sim.world.numSolverIterations, internalPgsIterations: this.sim.world.integrationParameters.numInternalPgsIterations, suppliedMassKg: this.suppliedMass, placedParts: this.count, altered: this.altered, events: this.events,
      connections: [...this.connections.values()].map(({ joint, grip, ...connection }) => ({ ...connection, grip: grip?.record(), constraintModel: grip ? 'compliant-breakable-grip' : 'ideal-fixed' })) };
  }
}
