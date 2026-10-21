import {beforeAll,expect,test} from 'vitest';
import {initialize,Simulation,G,shapeVerticesOf,rotationOf,transform,type Box} from '../src/simulation';
import {domeDefinition as detailedDomeDefinition,domeScenario} from '../src/dome';
import {ShedBuild} from '../src/shed';
import {hull,sub,cross,dot,length,unit,v} from '../src/geometry';
beforeAll(initialize);

// Independent separating-axis check: convex face normals and edge cross products.
function components(box:Box){return shapeVerticesOf(box).map(vs=>{
 const points=vs.map(p=>transform(p,rotationOf(box),box.position)),poly=hull(points);
 const faces=poly.faces.map(f=>f.map(i=>points[i]));
 return {points,normals:faces.map(f=>unit(cross(sub(f[1],f[0]),sub(f.at(-1)!,f[0])))),edges:faces.flatMap(f=>f.map((p,i)=>sub(f[(i+1)%f.length],p)))};
});}
function overlaps(a:ReturnType<typeof components>[number],b:ReturnType<typeof components>[number]){
 const separates=(axis:ReturnType<typeof v>)=>{if(length(axis)<1e-8)return false;const n=unit(axis),ap=a.points.map(p=>dot(p,n)),bp=b.points.map(p=>dot(p,n));return Math.min(Math.max(...ap),Math.max(...bp))-Math.max(Math.min(...ap),Math.min(...bp))<=1e-6;};
 if([v(1,0,0),v(0,1,0),v(0,0,1),...a.normals,...b.normals].some(separates))return false;
 return !a.edges.some(e=>b.edges.some(f=>separates(cross(e,f))));
}

test.each([6,8,8.01,10,10.01,12,16])('all shoring clears the structure and other stands at %s m diameter',(diameter)=>{
 const def=domeDefinition(diameter),temporary=new Set(def.temporaryProps),parts=def.plan.map(p=>({id:p.box.id,components:components(p.box)}));
 const collisions:string[]=[];
 for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++){
  const a=parts[i],b=parts[j];if(!temporary.has(a.id)&&!temporary.has(b.id))continue;
  if(a.components.some(ac=>b.components.some(bc=>overlaps(ac,bc))))collisions.push(`${a.id}/${b.id}`);
 }
 expect(collisions).toEqual([]);
 // A clear plan footprint matters for assembly, even if a foot could slide under a rail.
 const ring=def.plan.filter(p=>p.box.id.startsWith('dome-strut-')&&p.stage===1);
 for(const group of def.temporarySupportGroups!){const base=def.plan.find(p=>p.box.id===group[0])!.box;
  for(const rail of ring){const raised={...base,size:[base.size[0],.5,base.size[2]] as Box['size']};expect(components(raised).some(a=>components(rail.box).some(b=>overlaps(a,b))),base.id+'/'+rail.box.id).toBe(false);}
 }
});

test('isolated braced stand bears through contact, can slide, and its fastenings can break',()=>{
 const def=domeDefinition(),group=def.temporarySupportGroups![0],hub=def.plan.find(p=>p.connectTo.includes(group.at(-1)!))!;
 const selected=new Set(['dome-foundation',...group,hub.box.id]);
 const isolated={...def,plan:def.plan.filter(p=>selected.has(p.box.id)),temporaryProps:[],temporarySupportGroups:[],placementGroups:[group],withdrawShoringAfterStage:undefined};
 const sim=new Simulation(domeScenario()),build=new ShedBuild(sim,isolated);
 try{
  build.placeNext();const before=build.count;build.placeNext();expect(build.count-before).toBe(7);expect(group.every(id=>sim.parts.has(id))).toBe(true);while(!build.complete){build.placeNext();sim.run(.2);}
  sim.run(2);expect(build.failures).toEqual([]);
  expect([...build.connections.values()].every(c=>!!c.grip&&!c.joint)).toBe(true);
  expect([...build.connections.values()].some(c=>c.a==='dome-foundation'||c.b==='dome-foundation')).toBe(false);
  const weight=[...group,hub.box.id].reduce((sum,id)=>sum+sim.body(id).mass()*G,0);
  let reaction=0;for(let i=0;i<24;i++){sim.step();reaction+=sim.contacts().filter(c=>c.a==='dome-foundation'&&c.b===group[0]).reduce((s,c)=>s+c.force*Math.abs(c.normal.y),0)/24;}
  expect(reaction/weight).toBeCloseTo(1,1);
  const start=sim.body(group[0]).translation().x;
  for(const id of [...group,hub.box.id])sim.body(id).setLinvel(v(2,0,0),true);
  sim.run(.15);expect(sim.body(group[0]).translation().x-start).toBeGreaterThan(.05);
  const head=sim.body(hub.box.id);head.applyImpulse(v(head.mass()*30,0,0),true);sim.run(.2);
  expect(build.failures.some(f=>f.material==='Temporary support screw / bolt')).toBe(true);
 }finally{sim.dispose();}
},30000);

// Retain the original seven-body stands as the detailed reference model.
function domeDefinition(diameter=8){return detailedDomeDefinition(diameter,{detailedShoring:true});}
