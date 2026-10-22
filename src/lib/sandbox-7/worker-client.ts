import { transform, rotationOf, inverseRotation, multiplyRotations, type Box, type V3 } from './simulation';
import type { Command, Reply, Snapshot, WireConnection } from './worker-runtime';
import type { BuildDefinition, BuildPart } from './shed';

export class BodyView {
  constructor(private data: Float64Array) {}
  private vector(offset:number):V3 { return {x:this.data[offset],y:this.data[offset+1],z:this.data[offset+2]}; }
  translation(){return this.vector(0);}
  rotation(){return {...this.vector(3),w:this.data[6]};}
  linvel(){return this.vector(7);}
  angvel(){return this.vector(10);}
  worldCom(){return this.vector(13);}
  principalInertia(){return this.vector(16);}
  mass(){return this.data[19];}
}
export class SimulationView {
  readonly parts = new Map<string,{spec:Box;body:BodyView}>();
  ticks=0;dt=1/120;mass=0;
  private contactList: NonNullable<Snapshot['contacts']> = [];
  get time(){return this.ticks*this.dt;}
  body(id:string){return this.parts.get(id)!.body;}
  contacts(){return this.contactList;}
  apply(snapshot:Snapshot){
    const specs=snapshot.specs??[...this.parts.values()].map(p=>p.spec);
    this.parts.clear(); specs.forEach((spec,i)=>this.parts.set(spec.id,{spec,body:new BodyView(snapshot.poses.subarray(i*20,i*20+20))}));
    this.ticks=snapshot.ticks;this.dt=snapshot.dt;this.mass=snapshot.mass;
    if(snapshot.contacts)this.contactList=snapshot.contacts;
  }
}
export class BuildView {
  standInventory:NonNullable<Snapshot['build']>['standInventory']=[];
  count=0;suppliedMass=0;withdrawnMass=0;withdrawnParts:string[]=[];altered=false;automatic=false;connectionCount=0;
  failedConnections={size:0};connections=new Map<string,WireConnection>();
  failures:NonNullable<Snapshot['build']>['failures']=[];markers:V3[]=[];
  constructor(readonly sim:SimulationView,readonly plan:BuildPart[],readonly stages:readonly string[],readonly definition?:BuildDefinition){}
  get complete(){return this.count===this.plan.length;}
  get next(){return this.plan[this.count];}
  get nextPlacementIds(){return this.definition?.placementGroups?.find(g=>g[0]===this.next?.box.id)??(this.next?[this.next.box.id]:[]);}
  placement(spec:Box){
    const root=this.sim.parts.get(this.definition?.rootId??'base-left');
    if(!root)return {position:spec.position,rotation:rotationOf(spec)};
    const delta=multiplyRotations(root.body.rotation(),inverseRotation(rotationOf(root.spec)));
    return {position:transform({x:spec.position.x-root.spec.position.x,y:spec.position.y-root.spec.position.y,z:spec.position.z-root.spec.position.z},delta,root.body.translation()),rotation:multiplyRotations(delta,rotationOf(spec))};
  }
  apply(snapshot:NonNullable<Snapshot['build']>){
    Object.assign(this,{count:snapshot.count,suppliedMass:snapshot.suppliedMass,withdrawnMass:snapshot.withdrawnMass,withdrawnParts:snapshot.withdrawnParts,standInventory:snapshot.standInventory,altered:snapshot.altered,automatic:snapshot.automatic,connectionCount:snapshot.connectionCount,failures:snapshot.failures,markers:snapshot.markers});
    this.failedConnections.size=snapshot.failedCount;this.connections=new Map(snapshot.connections.map(c=>[c.id,c]));
  }
}
export class WorkerClient {
  private epoch=0;private request=0;private flight=false;private elapsed=0;
  private pending=new Map<number,{resolve:(reply:Reply)=>void;reject:(error:Error)=>void}>();
  onSnapshot?:(snapshot:Snapshot)=>void;
  onError?:(error:Error)=>void;
  constructor(private worker:Worker=new Worker(new URL('./physics.worker.ts',import.meta.url),{type:'module'})){
    this.worker.onmessage=({data}:MessageEvent<Reply>)=>{
      const waiter=this.pending.get(data.request);this.pending.delete(data.request);
      if(data.epoch!==this.epoch){waiter?.reject(new Error('Superseded'));return;}
      if(data.error){waiter?.reject(new Error(data.error));return;}
      if(data.snapshot)this.onSnapshot?.(data.snapshot);
      waiter?.resolve(data);
    };
    this.worker.onerror=event=>{
      const error=new Error(event.message||'Physics worker stopped');
      for(const p of this.pending.values())p.reject(error);this.pending.clear();this.onError?.(error);
    };
  }
  send(command:Command):Promise<Reply>{
    if(command.type==='reset'){this.epoch++;this.elapsed=0;}
    const request=++this.request,epoch=this.epoch;
    return new Promise((resolve,reject)=>{this.pending.set(request,{resolve,reject});this.worker.postMessage({epoch,request,command});});
  }
  advance(elapsed:number){
    this.elapsed+=elapsed;
    if(this.flight)return;
    const total=this.elapsed;this.elapsed=0;this.flight=true;
    this.send({type:'advance',elapsed:total}).catch(error=>{if(error.message!=='Superseded')this.onError?.(error);}).finally(()=>{this.flight=false;});
  }
  dispose(){this.worker.terminate();for(const p of this.pending.values())p.reject(new Error('Disposed'));this.pending.clear();}
}
