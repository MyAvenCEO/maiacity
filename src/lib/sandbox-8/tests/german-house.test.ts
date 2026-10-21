// @ts-nocheck — run by bun test, not type-checked, as the app's other tests
import {beforeAll,afterAll,describe,expect,test} from 'vitest';
import {initialize,Simulation,DT,G,volumeOf,verticesOf,transform,rotationOf,piecesOf,type Box} from '../simulation';
import {ShedBuild,jointPoint} from '../shed';
import {fasteningPatch} from '../fasteners';
import {Wind} from '../wind';
import {germanHouseDefinition,germanHouseScenario,OPENINGS} from '../german-house';

beforeAll(initialize);

test('the house supplies separate parts, real attachment faces and no starting overlaps',()=>{
 const def=germanHouseDefinition(),seen=new Map<string,Box>();
 expect(def.stages).toHaveLength(13);
 expect(OPENINGS).toHaveLength(20);
 // Individual clinker bricks and mortar joints are drawn; each facing lift collides as the
 // same solid: the drawn pieces fill exactly the volume of its collision boxes.
 const facing=def.plan.filter(p=>p.box.id.startsWith('facing-')||p.box.id.startsWith('lintel-'));
 expect(facing.reduce((n,p)=>n+(p.box.renderPieces?.length??0),0)).toBeGreaterThan(10000);
 expect(facing.reduce((n,p)=>n+piecesOf(p.box).length,0)).toBeLessThan(1000);
 for(const p of facing){
  const drawn=p.box.renderPieces!.reduce((v,r)=>v+r.size[0]*r.size[1]*r.size[2],0);
  expect(Math.abs(drawn-volumeOf(p.box))/volumeOf(p.box),p.box.id).toBeLessThan(1e-9);
 }
 for(const p of def.plan){
  expect(seen.has(p.box.id)).toBe(false);expect(volumeOf(p.box)).toBeGreaterThan(0);expect(p.box.fixed).not.toBe(true);
  if(p.box.id!=='house-foundation')expect(p.connectTo.length,p.box.id).toBeGreaterThan(0);
  for(const id of p.connectTo){
   expect(seen.has(id),`${p.box.id} -> ${id}`).toBe(true);
   expect(()=>jointPoint(p.box,seen.get(id)!)).not.toThrow();
   if(p.profile)expect(fasteningPatch(p.box,seen.get(id)!).points.length).toBeGreaterThanOrEqual(3);
  }
  seen.set(p.box.id,p.box);
 }
 const sim=new Simulation({...germanHouseScenario(),boxes:[...germanHouseScenario().boxes,...def.plan.map(p=>p.box)]});
 try{
  const parts=[...sim.parts.values()],bounds=parts.map(p=>{
   const points=verticesOf(p.spec).map(q=>transform(q,rotationOf(p.spec),p.spec.position));
   return (['x','y','z'] as const).map(a=>[Math.min(...points.map(q=>q[a])),Math.max(...points.map(q=>q[a]))]);
  });
  const overlaps:string[]=[];
  for(let a=0;a<parts.length;a++)for(let b=a+1;b<parts.length;b++){
   if(bounds[a].some(([lo,hi],i)=>lo>bounds[b][i][1]+1e-4||bounds[b][i][0]>hi+1e-4))continue;
   for(const ca of parts[a].colliders)for(const cb of parts[b].colliders){const c=ca.contactCollider(cb,0);if(c&&c.distance< -1e-4)overlaps.push(`${parts[a].spec.id}/${parts[b].spec.id}`);}
  }
  expect(overlaps).toEqual([]);
 }finally{sim.dispose();}
},300000);

describe('staged construction',()=>{
 const def=germanHouseDefinition();
 let sim:Simulation,build:ShedBuild;
 const stageFailures:Record<string,number>={};
 beforeAll(()=>{
  sim=new Simulation(germanHouseScenario(),DT);build=new ShedBuild(sim,def);
  let stage=-1;
  while(!build.complete){
   if(build.next.stage!==stage&&stage>=0){sim.run(.3);stageFailures[def.stages[stage]]=build.failures.length;}
   stage=build.next.stage;expect(build.placeNext()).toBe(true);sim.run(def.interval);
  }
  sim.run(1.5);stageFailures.complete=build.failures.length;
 },1800000);
 afterAll(()=>sim?.dispose());

 test('masonry, slabs, roof and joinery go up without connection damage and settle',()=>{
  expect(Object.values(stageFailures).every(n=>n===0),JSON.stringify(stageFailures)).toBe(true);
  expect(build.maxAnchorError()).toBeLessThan(.005);
  const speeds=sim.state().map(p=>Math.hypot(p.velocity.x,p.velocity.y,p.velocity.z));
  expect(Math.max(...speeds)).toBeLessThan(.02);
  for(const id of ['inner-leaf-upper-front','slab-top-2','rafter-pair-7','shingles-front-20','ridge-shingles','door-leaf-front-2','glazing-back-10']){
   const p=sim.parts.get(id)!,d=p.body.translation();
   expect(Math.hypot(d.x-p.spec.position.x,d.y-p.spec.position.y,d.z-p.spec.position.z),id).toBeLessThan(.01);
  }
 });

 test('supplied material is accounted for and carried into the ground',()=>{
  expect(sim.mass).toBeCloseTo(def.plan.reduce((n,p)=>n+volumeOf(p.box)*p.box.density,0),0);
  expect(sim.mass).toBeCloseTo(build.suppliedMass,0);
  expect([...sim.parts.values()].filter(p=>p.body.isFixed()).map(p=>p.spec.id)).toEqual(['ground']);
  let reaction=0;const n=12;
  for(let i=0;i<n;i++){sim.step();reaction+=sim.contacts().filter(c=>c.a==='ground').reduce((s,c)=>s+c.force*Math.abs(c.normal.y),0)/n;}
  expect(Math.abs(reaction/(sim.mass*G)-1)).toBeLessThan(.03);
 });

 test('the roof bears on the wall plates, the facing on the foundation',()=>{
  const pairs=new Set(sim.contacts().filter(c=>c.force>0).map(c=>[c.a,c.b].sort().join('|')));
  expect([...pairs].some(p=>p.includes('rafter-pair-7')&&p.includes('wall-plate-front'))).toBe(true);
  expect([...pairs].some(p=>p.includes('shingles-front-10')&&p.includes('underlayment-front'))).toBe(true);
  // Masonry is one rigidly bonded assembly whose internal contacts are not computed;
  // its ideal bonds are listed as such.
  expect([...build.connections.values()].filter(c=>c.fastening==='mortar-bond'&&!c.grip).length).toBeGreaterThan(200);
 });

 test('steady wind: no damage at 10 m/s, fixings fail at 100 m/s, nothing deleted',()=>{
  const ids=sim.state().map(p=>[p.id,p.mass]);
  const wind=new Wind(sim);wind.configure({enabled:true,speed:10,from:'front'});sim.run(.25);
  expect(build.failures).toEqual([]);
  wind.configure({enabled:true,speed:100,from:'front'});sim.run(.25);
  expect(build.failures.length).toBeGreaterThan(0);
  expect(build.failures.every(f=>f.reading.utilization>1)).toBe(true);
  expect(sim.state().map(p=>[p.id,p.mass])).toEqual(ids);
  expect(sim.state().every(p=>Object.values(p.position).every(Number.isFinite))).toBe(true);
 },900000);
});
