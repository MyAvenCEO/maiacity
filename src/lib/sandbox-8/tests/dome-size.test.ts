import RAPIER from '@dimforge/rapier3d-compat';
import {beforeAll,expect,test} from 'vitest';
import {initialize,Simulation,volumeOf,type Box} from '../src/simulation';
import {domeDefinition as detailedDomeDefinition,domeScenario} from '../src/dome';
import {ShedBuild} from '../src/shed';
import {Wind} from '../src/wind';
import {fasteningPatch} from '../src/fasteners';
import {v} from '../src/geometry';
beforeAll(initialize);

test.each([6,8,12,16])('diameter %s preserves physical attachments, doorway and support withdrawal',(diameter)=>{
 const def=domeDefinition(diameter),parts=new Map<string,Box>();
 for(const entry of def.plan){
  expect(volumeOf(entry.box)).toBeGreaterThan(0);
  for(const id of entry.connectTo)expect(fasteningPatch(entry.box,parts.get(id)!).points.length,`${entry.box.id}/${id}`).toBeGreaterThanOrEqual(3);
  parts.set(entry.box.id,entry.box);
 }
 expect(def.plan.filter(p=>p.box.opacity!==undefined).length).toBeGreaterThanOrEqual(12);
 const struts=def.plan.filter(p=>p.box.id.startsWith('dome-strut-'));
 expect(struts.length).toBe(diameter>10?225:60);
 const ring=def.plan.filter(p=>p.stage===1&&p.box.id.startsWith('dome-strut-')),degrees=new Map<string,number>();
 for(const edge of ring)for(const id of edge.connectTo)degrees.set(id,(degrees.get(id)??0)+1);
 expect(degrees.size).toBe(diameter>10?20:10);expect([...degrees.values()].every(n=>n===2)).toBe(true);
 if(diameter>10)expect(Math.max(...struts.map(p=>p.box.size[1]))).toBeLessThan(2.21);
 for(const {box} of struts){expect([.08,.10,.12]).toContain(box.size[0]);expect(box.size[2]).toBe(box.size[0]);}
 expect(parts.get('dome-foundation')!.size).toEqual([diameter+.6,.2,diameter+.6]);
 const sim=new Simulation(domeScenario(diameter)),build=new ShedBuild(sim,def);
 try{
  while(!build.complete)expect(build.placeNext()).toBe(true);
  sim.world.propagateModifiedBodyPositionsToColliders();
  const front=diameter/2+1;
  // Rays pass through the human-sized doorway, above the retained threshold.
  for(const x of [-.45,0,.45])for(const y of [.55,1.4,2.3]){
   const ray=new RAPIER.Ray(v(x,y,front),v(0,0,-1));
   const hits=[...sim.parts.values()].filter(p=>p.colliders.some(c=>c.castRay(ray,2.5,true)>=0)).map(p=>p.spec.id);
   expect(hits,`${diameter}m door at ${x},${y}`).toEqual([]);
  }
  expect(sim.mass).toBeCloseTo(def.plan.reduce((sum,p)=>sum+volumeOf(p.box)*p.box.density,0),1);
  for(const group of def.temporarySupportGroups!)expect(sim.body(group[0]).translation().x).toBeGreaterThan(diameter/2+1);
  expect(build.record().parameters?.diameterM).toBe(diameter);
 }finally{sim.dispose();}
});

test.each([NaN,Infinity,0,5.9])('rejects unsupported diameter %s before generating geometry',diameter=>{
 expect(()=>domeDefinition(diameter)).toThrow('diameter');expect(()=>domeScenario(diameter)).toThrow('diameter');
});

test.each([6,8.01,10,10.01,12,16])('resized %s m dome settles under gravity with finite connections',diameter=>{
 const sim=new Simulation(domeScenario(diameter)),build=new ShedBuild(sim,domeDefinition(diameter));
 try{
  while(!build.complete)build.placeNext();
  for(let i=0;i<36;i++){sim.step(10);if(build.failures.length)break;}
  expect(build.failures.slice(0,8).map(f=>`${f.a}/${f.b}: ${f.reading.utilization.toFixed(2)}`)).toEqual([]);expect(build.maxAnchorError()).toBeLessThan(.005);
  expect([...build.connections.values()].every(c=>!!c.grip)).toBe(true);
  if(diameter===16){
   const mass=sim.mass,wind=new Wind(sim);wind.configure({enabled:true,speed:10,from:'front'});sim.run(.3);
   expect(build.failures).toHaveLength(0);
   wind.configure({enabled:true,speed:100,from:'front'});sim.run(.3);
   expect(build.failures.length).toBeGreaterThan(0);expect(sim.mass).toBe(mass);
   expect(sim.state().every(p=>Object.values(p.position).every(Number.isFinite))).toBe(true);
  }
 }finally{sim.dispose();}
},300000);

// Retain the original seven-body stands as the detailed reference model.
function domeDefinition(diameter=8){return detailedDomeDefinition(diameter,{detailedShoring:true});}
