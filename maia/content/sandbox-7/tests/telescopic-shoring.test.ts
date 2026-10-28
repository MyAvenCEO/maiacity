// @ts-nocheck — run by bun test, not type-checked, as the app's other tests
import {beforeAll,expect,test} from 'vitest';
import {initialize,Simulation,shapeVerticesOf,transform,rotationOf,volumeOf,G} from '../simulation';
import {domeDefinition,domeScenario} from '../dome';
import {STAND_MODEL,MIN_OVERLAP} from '../telescopic-stand';
import {fasteningPatch} from '../fasteners';
import {ShedBuild} from '../shed';
beforeAll(initialize);

test.each([6,8,8.01,10,10.01,12,16])('%s m uses identical stock and constant stand mass at every height, with clear mounts',diameter=>{
 const def=domeDefinition(diameter),stands=def.plan.filter(p=>p.box.telescopic),mass=volumeOf(stands[0].box)*stands[0].box.density;
 const stock=(box:typeof stands[number]['box'])=>box.prefab!.components.map(c=>({size:c.size,pieces:c.pieces?.map(p=>p.size),density:c.density}));
 const reference=stands[0].box;
 const sim=new Simulation({...domeScenario(diameter),boxes:def.plan.map(p=>p.box)});
 try{
  for(const {box} of stands){
   expect(box.telescopic!.model).toBe(STAND_MODEL);expect(stock(box)).toEqual(stock(reference));
   expect(volumeOf(box)*box.density).toBeCloseTo(mass,7);
   expect(box.telescopic!.overlapM).toBeGreaterThanOrEqual(Math.min(MIN_OVERLAP,box.telescopic!.segmentLengthM*.2)-1e-8);
   expect(box.telescopic!.heightM).toBeGreaterThanOrEqual(box.telescopic!.minHeightM);
   expect(box.telescopic!.heightM).toBeLessThanOrEqual(box.telescopic!.maxHeightM);
   const hub=def.plan.find(p=>p.connectTo.includes(box.id))!.box;
   expect(hub.mountPoint!.faceSizeM).toEqual([.08,.08]);expect(hub.pieces!.at(-1)!.size[1]).toBeLessThan(.08);
   expect(Math.abs(fasteningPatch(box,hub).gap)).toBeLessThan(.00001);
  }
  // Check every stand collider, plus each permanent service pad, against all
  // other supplied parts. Touching is permitted; interpenetration is not.
  const collisions:string[]=[];
  for(const [id,a] of sim.parts){
   const colliders=a.spec.telescopic?a.colliders:a.spec.mountPoint?[a.colliders.at(-1)!]:[];
   if(!colliders.length)continue;
   for(const [other,b] of sim.parts){if(other===id)continue;
    for(const ca of colliders)for(const cb of b.colliders){const c=ca.contactCollider(cb,0);if(c&&c.distance<-.0001)collisions.push(`${id}/${other}: ${c.distance}`);}
   }
  }
  expect(collisions.slice(0,20)).toEqual([]);
 }finally{sim.dispose();}
},60000);

test('telescopic stand has the same mass and center of mass and can slide; its hub bolts can fail',()=>{
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
  expect(early).toBe(true);
  expect(build.standInventory.length).toBe(peak);
  expect(build.standInventory.every(a=>a.available)).toBe(true);
  expect(build.standInventory.some(a=>a.uses>1)).toBe(true);
  const adjustments=build.events.filter(e=>e.action==='adjust-stand');
  expect(adjustments).toHaveLength(build.definition!.temporaryProps!.length);
  expect(adjustments.some(e=>e.reused)).toBe(true);
  for(const asset of build.standInventory)expect(adjustments.filter(e=>e.assetId===asset.id)).toHaveLength(asset.uses);expect(peak).toBeLessThan(build.definition!.temporaryProps!.length);
  expect([...sim.parts.keys()].some(id=>id.startsWith('assembly-prop'))).toBe(false);
  expect(build.withdrawnParts.size).toBe(build.definition!.temporaryProps!.length);
  expect(sim.mass+build.withdrawnMass).toBeCloseTo(build.suppliedMass,1);
  expect(build.events.filter(e=>e.action==='withdraw-shoring').reduce((s,e)=>s+(e.massOutKg??0),0)).toBeCloseTo(build.withdrawnMass,6);
  expect([...build.connections.values()].every(c=>sim.parts.has(c.a)&&sim.parts.has(c.b))).toBe(true);
  expect(sim.contacts().every(c=>sim.parts.has(c.a)&&sim.parts.has(c.b))).toBe(true);
 }finally{sim.dispose();}
},180000);

