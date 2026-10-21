import {beforeAll,expect,test} from 'vitest';
import {initialize,Simulation,shapeVerticesOf,transform,rotationOf,volumeOf,G} from '../src/simulation';
import {domeDefinition as currentDomeDefinition,domeScenario} from '../src/dome';
import {ShedBuild} from '../src/shed';
beforeAll(initialize);

test.each([6,8,10,12,16])('%s m compact stands retain collision geometry, component masses and workshop instructions',diameter=>{
 const def=domeDefinition(diameter),detailed=domeDefinition(diameter,{detailedShoring:true});
 for(const entry of def.plan.filter(p=>p.box.prefab)){
  const prefab=entry.box.prefab!,original=prefab.components;
  expect(original).toHaveLength(7);expect(prefab.fastenings.length).toBeGreaterThan(6);
  const mass=original.reduce((s,p)=>s+volumeOf(p)*p.density,0);expect(volumeOf(entry.box)*entry.box.density).toBeCloseTo(mass,7);
  const points=(box:typeof entry.box)=>shapeVerticesOf(box).flat().map(p=>transform(p,rotationOf(box),box.position)).map(p=>[p.x,p.y,p.z].map(n=>n.toFixed(5)).join('/')).sort();
  expect(points(entry.box)).toEqual(original.flatMap(points).sort());
  expect(detailed.plan.filter(p=>original.some(c=>c.id===p.box.id))).toHaveLength(7);
 }
 const defIds=new Set(def.plan.map(p=>p.box.id));for(const rule of def.shoringReleaseAfter!){expect(defIds.has(rule.afterPart)).toBe(true);expect(rule.parts.every(id=>def.temporaryProps!.includes(id))).toBe(true);}
});

test('one compound stand has the same mass and center of mass and can slide; its hub bolts can fail',()=>{
 const def=domeDefinition(),entry=def.plan.find(p=>p.box.prefab)!,hub=def.plan.find(p=>p.connectTo.includes(entry.box.id))!;
 const isolated={...def,plan:[def.plan[0],entry,hub],temporaryProps:[],shoringReleaseAfter:[],withdrawShoringAfterStage:undefined};
 const sim=new Simulation(domeScenario()),build=new ShedBuild(sim,isolated);
 try{
  while(!build.complete)build.placeNext();
  const components=entry.box.prefab!.components,reference=new Simulation({...domeScenario(),boxes:components});
  try{
   const mass=reference.mass,expected={x:0,y:0,z:0};for(const p of reference.parts.values()){const c=p.body.worldCom();expected.x+=c.x*p.body.mass()/mass;expected.y+=c.y*p.body.mass()/mass;expected.z+=c.z*p.body.mass()/mass;}
   expect(sim.body(entry.box.id).mass()).toBeCloseTo(mass,3);const actual=sim.body(entry.box.id).worldCom();for(const axis of ['x','y','z']as const)expect(actual[axis]).toBeCloseTo(expected[axis],5);
  }finally{reference.dispose();}
  sim.run(1);expect(build.failures).toHaveLength(0);
  let reaction=0;for(let i=0;i<24;i++){sim.step();reaction+=sim.contacts().filter(c=>c.a==='dome-foundation'&&c.b===entry.box.id).reduce((s,c)=>s+c.force*Math.abs(c.normal.y),0)/24;}
  expect(reaction/((sim.body(entry.box.id).mass()+sim.body(hub.box.id).mass())*G)).toBeCloseTo(1,1);
  const start=sim.body(entry.box.id).translation().x;for(const id of [entry.box.id,hub.box.id])sim.body(id).setLinvel({x:2,y:0,z:0},true);sim.run(.15);expect(sim.body(entry.box.id).translation().x-start).toBeGreaterThan(.05);
  const body=sim.body(hub.box.id);body.applyImpulse({x:body.mass()*100,y:0,z:0},true);sim.run(.2);expect(build.failures.length).toBeGreaterThan(0);
 }finally{sim.dispose();}
});

test.each([6,8,10,12,16])('%s m staged construction removes stands early and accounts for outgoing material',diameter=>{
 const sim=new Simulation(domeScenario(diameter)),build=new ShedBuild(sim,domeDefinition(diameter));let stage=-1,withdrawn=0,peak=0,early=false;
 try{
  while(!build.complete){
   if(stage!==build.next.stage){if(stage>=0){sim.run(.3);expect(build.failures).toEqual([]);}stage=build.next.stage;}
   expect(build.placeNext()).toBe(true);sim.step();
   if(build.withdrawnParts.size!==withdrawn){sim.run(.15);withdrawn=build.withdrawnParts.size;if(stage<4)early=true;}
   expect(build.failures.slice(0,3)).toEqual([]);
   peak=Math.max(peak,[...sim.parts.keys()].filter(id=>id.startsWith('assembly-prop')).length);
  }
  sim.run(1);expect(build.failures).toEqual([]);expect(build.maxAnchorError()).toBeLessThan(.005);
  expect(early).toBe(true);expect(peak).toBeLessThan(build.definition!.temporaryProps!.length);
  expect([...sim.parts.keys()].some(id=>id.startsWith('assembly-prop'))).toBe(false);
  expect(build.withdrawnParts.size).toBe(build.definition!.temporaryProps!.length);
  expect(sim.mass+build.withdrawnMass).toBeCloseTo(build.suppliedMass,1);
  expect(build.events.filter(e=>e.action==='withdraw-shoring').reduce((s,e)=>s+(e.massOutKg??0),0)).toBeCloseTo(build.withdrawnMass,6);
  expect([...build.connections.values()].every(c=>sim.parts.has(c.a)&&sim.parts.has(c.b))).toBe(true);
  expect(sim.contacts().every(c=>sim.parts.has(c.a)&&sim.parts.has(c.b))).toBe(true);
 }finally{sim.dispose();}
},180000);

// Historical seven-component compact stand baseline.
function domeDefinition(diameter=8,options:{detailedShoring?:boolean}={}){return currentDomeDefinition(diameter,{...options,legacyCompactShoring:true});}
