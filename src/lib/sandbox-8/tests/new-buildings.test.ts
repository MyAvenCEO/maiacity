import {beforeAll,afterEach,expect,test} from 'vitest';
import {initialize,Simulation,DT,G,volumeOf,type Box} from '../src/simulation';
import {ShedBuild,jointPoint} from '../src/shed';
import {metalShedDefinition,metalShedScenario} from '../src/metal-shed';
import {domeDefinition as detailedDomeDefinition,domeScenario,domeMesh} from '../src/dome';
import {fasteningPatch} from '../src/fasteners';
import {Wind,AIR_DENSITY,DRAG_COEFFICIENT} from '../src/wind';
import {hull,length,v} from '../src/geometry';
beforeAll(initialize);const worlds:Simulation[]=[];afterEach(()=>worlds.splice(0).forEach(s=>s.dispose()));
const definitions={metal:metalShedDefinition,dome:domeDefinition},scenarios={metal:metalShedScenario,dome:domeScenario};
function lab(which:keyof typeof definitions,dt=DT){const def=definitions[which](),sim=new Simulation(scenarios[which](),dt);worlds.push(sim);return {sim,def,build:new ShedBuild(sim,def)};}

test('2V dome is a hemispherical triangulation with a closed base ring and a pentagonal entrance bay',()=>{
 const mesh=domeMesh();expect(mesh.vertices).toHaveLength(26);expect(mesh.faces).toHaveLength(40);
 for(const p of mesh.vertices){expect(length(p)).toBeCloseTo(1,10);expect(p.y).toBeGreaterThanOrEqual(0);}
 const counts=new Map<string,number>();for(const f of mesh.faces)for(let i=0;i<3;i++){const key=[f[i],f[(i+1)%3]].sort((a,b)=>a-b).join('/');counts.set(key,(counts.get(key)??0)+1);}
 expect(counts.size).toBe(65);expect([...counts.values()].filter(n=>n===1)).toHaveLength(10);expect([...counts.values()].every(n=>n===1||n===2)).toBe(true);
 const d=domeDefinition();expect(d.plan.filter(p=>p.box.id.startsWith('dome-panel-')&&!p.box.id.includes('bracket'))).toHaveLength(35);
 expect(d.plan.filter(p=>p.box.id.startsWith('dome-strut-'))).toHaveLength(60);
 expect(d.temporarySupportGroups).toHaveLength(15);
 expect(d.temporaryProps).toHaveLength(105);
});

test.each(['metal','dome'] as const)('%s supplies separate material and declares only actual touching attachment faces',which=>{
 const def=definitions[which](),seen=new Map<string,Box>();
 for(const p of def.plan){expect(seen.has(p.box.id)).toBe(false);expect(volumeOf(p.box)).toBeGreaterThan(0);expect(p.box.fixed).not.toBe(true);
  for(const id of p.connectTo){expect(seen.has(id),`${p.box.id} -> ${id}`).toBe(true);expect(()=>jointPoint(p.box,seen.get(id)!)).not.toThrow();if(p.profile)expect(fasteningPatch(p.box,seen.get(id)!).points.length).toBeGreaterThanOrEqual(3);}
  seen.set(p.box.id,p.box);
 }
 const {sim,build}=lab(which);while(!build.complete)expect(build.placeNext()).toBe(true);
 expect(sim.mass).toBeCloseTo(def.plan.reduce((n,p)=>n+volumeOf(p.box)*p.box.density,0),1);
 expect(sim.parts.size).toBe(def.plan.length+1);expect([...sim.parts.values()].filter(p=>p.body.isFixed()).map(p=>p.spec.id)).toEqual(['ground']);
});

test('triangular solids have correct volume, mass and projected wind area',()=>{
 const spec:Box={id:'triangle',size:[2,2,.01],position:v(),density:1200,material:'Panel',color:0,friction:.6,polyhedron:hull([v(0,0,-.005),v(2,0,-.005),v(0,2,-.005),v(0,0,.005),v(2,0,.005),v(0,2,.005)])};
 expect(volumeOf(spec)).toBeCloseTo(.02,10);
 const sim=new Simulation({id:'triangle',title:'Triangle',question:'',boxes:[spec]});worlds.push(sim);expect(sim.mass).toBeCloseTo(24,4);
 const wind=new Wind(sim);wind.configure({enabled:true,speed:10,from:'front'});wind.measure();const load=wind.loads.get('triangle')!;
 expect(load.exposedArea).toBeCloseTo(2,8);expect(load.force.z).toBeCloseTo(-.5*AIR_DENSITY*DRAG_COEFFICIENT*2*100,5);
});

test.each([['metal',DT],['metal',DT/2],['dome',DT],['dome',DT/2]] as const)('%s stands without damage and has finite wind failure at dt=%s',(which,dt)=>{
 const {sim,build}=lab(which,dt);while(!build.complete)expect(build.placeNext()).toBe(true);
 const ids=sim.state().map(p=>[p.id,p.mass]);sim.run(3);
 expect(build.failures).toEqual([]);expect(build.maxAnchorError()).toBeLessThan(.005);
 let reaction=0;for(let i=0;i<Math.round(.2/dt);i++){sim.step();reaction+=sim.contacts().filter(c=>c.a==='ground').reduce((n,c)=>n+c.force*Math.abs(c.normal.y),0)/Math.round(.2/dt);}
 expect(Math.abs(reaction/(sim.mass*G)-1)).toBeLessThan(.03);
 const wind=new Wind(sim);wind.configure({enabled:true,speed:10,from:'front'});sim.run(.3);expect(build.failures).toEqual([]);
 wind.configure({enabled:true,speed:100,from:'front'});sim.run(.3);expect(build.failures.length).toBeGreaterThan(0);expect(build.failedConnections.size).toBeGreaterThan(0);
 expect(sim.state().map(p=>[p.id,p.mass])).toEqual(ids);expect(sim.state().every(p=>Object.values(p.position).every(Number.isFinite))).toBe(true);
 expect(build.failures.every(f=>f.reading.utilization>1)).toBe(true);
},120000);

test.each(['metal','dome'] as const)('%s builds in order, settles at every stage, and withdraws only declared props',which=>{
 const {sim,build,def}=lab(which);let stage=-1;
 while(!build.complete){const nextStage=build.next.stage;
  if(stage!==nextStage&&stage>=0){sim.run(def.withdrawShoringAfterStage===stage?3:.3);expect(build.failures,def.stages[stage]).toEqual([]);if(def.withdrawShoringAfterStage===stage)expect(build.events.filter(e=>e.action==='withdraw-shoring')).toHaveLength(def.temporaryProps!.length);}
  stage=nextStage;expect(build.placeNext()).toBe(true);sim.run(def.interval);
  expect(build.failures,build.plan[build.count-1].box.id).toEqual([]);
 }
 const withdrawals=build.events.filter(e=>e.action==='withdraw-shoring');expect(withdrawals.map(e=>e.part)).toEqual(def.temporaryProps??[]);
 for(const id of def.temporaryProps??[]){const group=def.temporarySupportGroups?.find(g=>g.includes(id));expect([...build.connections.values()].filter(c=>c.a===id||c.b===id).every(c=>group?.includes(c.a)&&group.includes(c.b))).toBe(true);expect(sim.body(id).translation().x).toBeGreaterThan(4.5);}
 sim.run(3);expect(build.failures).toEqual([]);expect(build.maxAnchorError()).toBeLessThan(.005);
 expect(sim.mass).toBeCloseTo(build.suppliedMass,1);
},180000);

// Retain the original seven-body stands as the detailed reference model.
function domeDefinition(diameter=8){return detailedDomeDefinition(diameter,{detailedShoring:true});}
