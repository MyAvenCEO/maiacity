// @ts-nocheck — run by bun test, not type-checked, as the app's other tests
import {beforeAll,afterAll,describe,expect,test} from 'vitest';
import {initialize,Simulation,DT,G,volumeOf,verticesOf,transform,rotationOf,type Box} from '../simulation';
import {ShedBuild,jointPoint} from '../shed';
import {fasteningPatch} from '../fasteners';
import {Wind} from '../wind';
import {industrialHallDefinition,industrialHallScenario,HALL} from '../industrial-hall';

beforeAll(initialize);

test('industrial hall supplies separate parts, real attachment faces and no starting overlaps',()=>{
 const def=industrialHallDefinition(),seen=new Map<string,Box>();
 expect(def.stages).toHaveLength(11);
 expect(def.plan.filter(p=>p.box.id.startsWith('column-'))).toHaveLength(10);
 expect(def.plan.filter(p=>p.box.id.startsWith('rafter-'))).toHaveLength(10);
 expect(def.placementGroups).toHaveLength(5);
 for(const p of def.plan){
  expect(seen.has(p.box.id)).toBe(false);expect(volumeOf(p.box)).toBeGreaterThan(0);expect(p.box.fixed).not.toBe(true);
  // Everything after the slab is fastened to something already in place.
  if(p.box.id!=='hall-slab')expect(p.connectTo.length,p.box.id).toBeGreaterThan(0);
  for(const id of p.connectTo){
   expect(seen.has(id),`${p.box.id} -> ${id}`).toBe(true);
   expect(()=>jointPoint(p.box,seen.get(id)!)).not.toThrow();
   expect(fasteningPatch(p.box,seen.get(id)!).points.length).toBeGreaterThanOrEqual(3);
  }
  seen.set(p.box.id,p.box);
 }
 // Every supplied part starts clear of every other part (touching is allowed).
 const sim=new Simulation({...industrialHallScenario(),boxes:[...industrialHallScenario().boxes,...def.plan.map(p=>p.box)]});
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
});

describe('staged construction',()=>{
 const def=industrialHallDefinition();
 let sim:Simulation,build:ShedBuild;
 const stageFailures:Record<string,number>={};
 beforeAll(()=>{
  sim=new Simulation(industrialHallScenario(),DT);build=new ShedBuild(sim,def);
  let stage=-1;
  while(!build.complete){
   if(build.next.stage!==stage&&stage>=0){sim.run(.5);stageFailures[def.stages[stage]]=build.failures.length;}
   stage=build.next.stage;expect(build.placeNext()).toBe(true);sim.run(def.interval);
  }
  sim.run(2);stageFailures.complete=build.failures.length;
 },900000);
 afterAll(()=>sim?.dispose());

 test('each stage, including bare portal frames, stands without connection damage',()=>{
  expect(Object.values(stageFailures).every(n=>n===0),JSON.stringify(stageFailures)).toBe(true);
  expect(build.maxAnchorError()).toBeLessThan(.005);
  // The structure has settled: no part is still creeping or vibrating.
  const speeds=sim.state().map(p=>Math.hypot(p.velocity.x,p.velocity.y,p.velocity.z));
  expect(Math.max(...speeds)).toBeLessThan(.02);
  for(const id of ['rafter-3-left','rafter-3-right','roof-panel-left-10','door-section-8','gable-panel-front-middle-row-6']){
   const p=sim.parts.get(id)!,d=p.body.translation();
   expect(Math.hypot(d.x-p.spec.position.x,d.y-p.spec.position.y,d.z-p.spec.position.z),id).toBeLessThan(.01);
  }
 });

 test('supplied material is accounted for and carried into the ground',()=>{
  expect(sim.mass).toBeCloseTo(def.plan.reduce((n,p)=>n+volumeOf(p.box)*p.box.density,0),0);
  expect(sim.mass).toBeCloseTo(build.suppliedMass,0);
  expect([...sim.parts.values()].filter(p=>p.body.isFixed()).map(p=>p.spec.id)).toEqual(['ground']);
  let reaction=0;const n=Math.round(.2/DT);
  for(let i=0;i<n;i++){sim.step();reaction+=sim.contacts().filter(c=>c.a==='ground').reduce((s,c)=>s+c.force*Math.abs(c.normal.y),0)/n;}
  expect(Math.abs(reaction/(sim.mass*G)-1)).toBeLessThan(.03);
 });

 test('frames carry the roof through the slab and keep their geometry',()=>{
  const slab=sim.body('hall-slab'),spec=sim.parts.get('hall-slab')!.spec;
  expect(Math.abs(slab.translation().y-spec.position.y)).toBeLessThan(.002);
  // Columns bear on the slab, rafters on the columns, purlins on rafters.
  const pairs=new Set(sim.contacts().filter(c=>c.force>0).map(c=>[c.a,c.b].sort().join('|')));
  expect(pairs.has(['column-3-left','hall-slab'].sort().join('|'))).toBe(true);
  expect([...pairs].some(p=>p.includes('purlin-left-1-bay-2')&&p.includes('rafter-'))).toBe(true);
  const ridge=sim.body('rafter-3-left').translation().y-sim.parts.get('rafter-3-left')!.spec.position.y;
  expect(Math.abs(ridge)).toBeLessThan(.01);
  expect(HALL.span).toBe(12);
 });

 test('steady wind: no damage at 10 m/s, finite separation at 100 m/s, nothing deleted',()=>{
  const ids=sim.state().map(p=>[p.id,p.mass]);
  const wind=new Wind(sim);wind.configure({enabled:true,speed:10,from:'front'});sim.run(.4);
  expect(build.failures).toEqual([]);
  const total=[...wind.loads.values()].reduce((s,l)=>s+l.force.z,0);expect(total).toBeLessThan(0);
  wind.configure({enabled:true,speed:100,from:'front'});sim.run(.4);
  expect(build.failures.length).toBeGreaterThan(0);expect(build.failedConnections.size).toBeGreaterThan(0);
  expect(build.failures.every(f=>f.reading.utilization>1)).toBe(true);
  expect(sim.state().map(p=>[p.id,p.mass])).toEqual(ids);
  expect(sim.state().every(p=>Object.values(p.position).every(Number.isFinite))).toBe(true);
 },300000);
});

test('a released roof panel still rests on its purlins by contact and friction',()=>{
 const def=industrialHallDefinition();def.plan=def.plan.filter(p=>p.stage<=5||p.box.id==='roof-panel-left-10');
 const sim=new Simulation(industrialHallScenario(),DT),build=new ShedBuild(sim,def);
 try{
  while(!build.complete){build.placeNext();sim.run(def.interval);}
  sim.run(1);const before=sim.body('roof-panel-left-10').translation(),mass=sim.mass;
  expect(build.release('roof-panel-left-10')).toBeGreaterThan(0);sim.run(1.5);
  const after=sim.body('roof-panel-left-10').translation();
  // A 10° slope is well inside the friction cone (μ = 0.6), so the panel stays put.
  expect(Math.hypot(after.x-before.x,after.y-before.y,after.z-before.z)).toBeLessThan(.005);
  expect(sim.contacts().some(c=>[c.a,c.b].includes('roof-panel-left-10')&&c.force>0)).toBe(true);
  expect(sim.mass).toBe(mass);
 }finally{sim.dispose();}
},300000);
