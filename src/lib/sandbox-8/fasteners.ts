import RAPIER from '@dimforge/rapier3d-compat';
import { facesOf, transform, rotationOf, inverseRotation, type Box, type V3, type Simulation } from './simulation';

const zero = { x: 0, y: 0, z: 0 };
const add = (a: V3, b: V3): V3 => ({ x: a.x+b.x, y: a.y+b.y, z: a.z+b.z });
const sub = (a: V3, b: V3): V3 => ({ x: a.x-b.x, y: a.y-b.y, z: a.z-b.z });
const mul = (a: V3, s: number): V3 => ({ x: a.x*s, y: a.y*s, z: a.z*s });
const dot = (a: V3, b: V3) => a.x*b.x+a.y*b.y+a.z*b.z;
const cross = (a: V3, b: V3): V3 => ({ x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x });
const length = (a: V3) => Math.hypot(a.x,a.y,a.z);
const unit = (a: V3) => mul(a,1/length(a));

type P2 = { x: number; y: number };
const cross2 = (a: P2,b:P2,c:P2) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function clip(subject: P2[], boundary: P2[]): P2[] {
  let result = subject;
  for (let i=0; i<boundary.length; i++) {
    const a=boundary[i], b=boundary[(i+1)%boundary.length], input=result; result=[];
    for (let j=0;j<input.length;j++) {
      const p=input[j], q=input[(j+1)%input.length], dp=cross2(a,b,p), dq=cross2(a,b,q);
      if(dp>=-1e-9) result.push(p);
      if ((dp>=0)!==(dq>=0)) { const t=dp/(dp-dq); result.push({x:p.x+t*(q.x-p.x),y:p.y+t*(q.y-p.y)}); }
    }
  }
  return result;
}
/** A real shared face, including pitched roof faces. Never invent an attachment outside the wood. */
export function fasteningPatch(a: Box,b: Box, clearanceM=0): { points: V3[]; normal: V3; gap: number } {
  const av=facesOf(a).map(face=>face.map(p=>transform(p,rotationOf(a),a.position)));
  const bv=facesOf(b).map(face=>face.map(p=>transform(p,rotationOf(b),b.position)));
  let best: {points:V3[];normal:V3;area:number;gap:number}|undefined;
  for(const va of av) {
    const origin=va[0], u=unit(sub(va[1],origin)), n=unit(cross(sub(va[1],origin),sub(va[va.length-1],origin))), v=cross(n,u);
    const project=(p:V3):P2=>({x:dot(sub(p,origin),u),y:dot(sub(p,origin),v)});
    const boundary=va.map(project);
    for(const vb of bv) {
      const gap=dot(sub(vb[0],origin),n);
      if(gap < -1e-5 || gap > clearanceM+1e-5 || vb.some(p=>Math.abs(dot(sub(p,origin),n)-gap)>1e-5)) continue;
      const nb=unit(cross(sub(vb[1],vb[0]),sub(vb[vb.length-1],vb[0])));
      if(dot(n,nb)>-.999) continue;
      const polygon=clip(vb.map(project).reverse(),boundary);
      const area=Math.abs(polygon.reduce((sum,p,i)=>sum+p.x*polygon[(i+1)%polygon.length].y-p.y*polygon[(i+1)%polygon.length].x,0))/2;
      if(area<1e-8 || (best && area<=best.area)) continue;
      // A bilinear inset of the face corners gives a separated fastening group.
      const center=mul(polygon.map(p=>add(origin,add(mul(u,p.x),mul(v,p.y)))).reduce(add,zero),1/polygon.length);
      const points=polygon.map(p=>add(center,mul(sub(add(origin,add(mul(u,p.x),mul(v,p.y))),center),.6)));
      best={points,normal:mul(n,-1),area,gap:Math.max(0,gap)};
    }
  }
  if(!best) throw Error(`No fastening face: ${a.id}/${b.id}`);
  // Service pads use their declared four-bolt pattern, independent of polygon
  // clipping's extra collinear vertices when the head is rotated.
  const mounting=a.telescopic&&b.mountPoint?b:b.telescopic&&a.mountPoint?a:undefined;
  if(mounting){
    const mount=mounting.mountPoint!,center=transform(mount.position,rotationOf(mounting),mounting.position);
    const normal=transform(mount.normal,rotationOf(mounting),zero);
    if(Math.abs(dot(best.normal,normal))>.999&&Math.abs(dot(sub(center,best.points[0]),normal))<1e-5){
      best.points=[-1,1].flatMap(x=>[-1,1].map(z=>{
        const local=transform({x:x*mount.boltPatternM[0]/2,y:0,z:z*mount.boltPatternM[1]/2},mount.orientation,mount.position);
        return transform(local,rotationOf(mounting),mounting.position);
      }));
    }
  }
  return best;
}
export type FastenerProfile = { name: string; stiffness: number; damping: number; withdrawalN: number; shearN: number; clearanceM?: number };
// Deliberately illustrative lab capacities per fastening point, not design values.
export const WOOD_FASTENER: FastenerProfile = { name:'Wood grip', stiffness:5e5, damping:1000, withdrawalN:1500, shearN:2500 };
export const FELT_BOND: FastenerProfile = { name:'Felt adhesive', stiffness:1e5, damping:500, withdrawalN:300, shearN:600 };
export type FastenerReading = { withdrawalN: number; shearN: number; utilization: number; separationM: number; mode: 'withdrawal'|'shear' };
export type FastenerPoint = { anchorA: V3; anchorB: V3; joint: RAPIER.ImpulseJoint; failed: boolean; reading: FastenerReading };
export class FastenerGroup {
  readonly points: FastenerPoint[];
  readonly normalA: V3;
  readonly restLength: number;
  constructor(readonly sim:Simulation,readonly a:string,readonly b:string,readonly profile:FastenerProfile) {
    const pa=sim.parts.get(a)!,pb=sim.parts.get(b)!, patch=fasteningPatch(pa.spec,pb.spec,profile.clearanceM);
    this.restLength=patch.gap;
    this.normalA=transform(patch.normal,inverseRotation(rotationOf(pa.spec)),zero);
    this.points=patch.points.map(point=>{
      const anchorA=transform(sub(point,pa.spec.position),inverseRotation(rotationOf(pa.spec)),zero);
      const anchorB=transform(sub(sub(point,mul(patch.normal,patch.gap)),pb.spec.position),inverseRotation(rotationOf(pb.spec)),zero);
      const joint=sim.world.createImpulseJoint(RAPIER.JointData.spring(this.restLength,profile.stiffness,profile.damping,anchorA,anchorB),pa.body,pb.body,true);
      joint.setContactsEnabled(true);
      return {anchorA,anchorB,joint,failed:false,reading:{withdrawalN:0,shearN:0,utilization:0,separationM:0,mode:'withdrawal' as const}};
    });
  }
  get intact() {return this.points.filter(p=>!p.failed).length;}
  measure(): FastenerReading[] {
    const a=this.sim.body(this.a),b=this.sim.body(this.b);
    const rotationA=a.rotation(),rotationB=b.rotation(),positionA=a.translation(),positionB=b.translation();
    const n=transform(this.normalA,rotationA,zero);
    for(const p of this.points) {
      if(p.failed)continue;
      const pa=transform(p.anchorA,rotationA,positionA),pb=transform(p.anchorB,rotationB,positionB), displacement=sub(pa,pb), distance=length(displacement);
      // Elastic grip demand. The spring's viscous damping stabilizes motion but
      // is deliberately not interpreted as wood strength or accumulated damage.
      const force=mul(displacement,distance>1e-12 ? this.profile.stiffness*(distance-this.restLength)/distance : 0), normal=dot(force,n);
      const withdrawalN=Math.max(0,normal),shearN=length(sub(force,mul(n,normal)));
      const w=withdrawalN/this.profile.withdrawalN,s=shearN/this.profile.shearN;
      p.reading={withdrawalN,shearN,utilization:Math.hypot(w,s),separationM:distance,mode:w>=s?'withdrawal':'shear'};
    }
    return this.points.map(p=>p.reading);
  }
  failOverloaded(): number[] {
    this.measure();const failed:number[]=[];
    this.points.forEach((p,i)=>{if(!p.failed && p.reading.utilization>1){this.sim.world.removeImpulseJoint(p.joint,true);p.failed=true;failed.push(i);}});
    return failed;
  }
  remove() {for(const p of this.points)if(!p.failed){this.sim.world.removeImpulseJoint(p.joint,true);p.failed=true;}}
  record() {return {profile:this.profile,restLengthM:this.restLength,normalA:this.normalA,points:this.points.map(({joint,...p})=>p)};}
}
