import {beforeAll,expect,test} from 'vitest';
import {initialize,Simulation,volumeOf,G} from '../src/simulation';
import {ShedBuild} from '../src/shed';
import {standDefinition,standScenario,STAND_HUBS} from '../src/stand-lab';
import {fasteningPatch} from '../src/fasteners';
import {WorkerRuntime} from '../src/worker-runtime';
beforeAll(initialize);

test('extension moves the same stock without changing stand mass; every hub has a real mounting face',()=>{
 let reference:number|undefined;
 for(const hub of Object.keys(STAND_HUBS) as (keyof typeof STAND_HUBS)[])for(const heightM of [1.253,4,8.45]){
  const def=standDefinition({heightM,loadKg:0,friction:.65,hub}),stand=def.plan[1].box,fitting=def.plan[2].box;
  const mass=volumeOf(stand)*stand.density;reference??=mass;expect(mass).toBeCloseTo(reference,6);
  expect(stand.telescopic!.heightM).toBeCloseTo(heightM,6);
  expect(fasteningPatch(stand,fitting).points).toHaveLength(4);
  expect(fasteningPatch(stand,fitting).gap).toBeLessThan(.00001);
  const sim=new Simulation({...standScenario(),boxes:def.plan.map(p=>p.box)});
  try{const a=sim.parts.get('test-stand')!,b=sim.parts.get('test-head-fitting')!;
   for(const ca of a.colliders)for(const cb of b.colliders){const contact=ca.contactCollider(cb,0);expect(contact?.distance??0).toBeGreaterThan(-.0001);}
  }finally{sim.dispose();}
 }
});

test('unloaded stand bears through its foot; a loose top load is not welded to it',()=>{
 const sim=new Simulation(standScenario()),build=new ShedBuild(sim,standDefinition({heightM:4,loadKg:10,friction:.65}));
 try{while(!build.complete)build.placeNext();sim.run(1);expect(build.failures).toEqual([]);
  expect([...build.connections.values()].some(c=>c.a==='test-load'||c.b==='test-load')).toBe(false);
  let reaction=0;for(let i=0;i<24;i++){sim.step();reaction+=sim.contacts().filter(c=>c.a==='stand-platform'&&c.b==='test-stand').reduce((s,c)=>s+c.force*Math.abs(c.normal.y),0)/24;}
  const weight=['test-stand','test-head-fitting','test-load'].reduce((s,id)=>s+sim.body(id).mass()*G,0);
  expect(Math.abs(reaction/weight-1)).toBeLessThan(.03);
 }finally{sim.dispose();}
});

test('worker supports hub choice, extension reset and a destructive head impulse',()=>{
 const runtime=new WorkerRuntime();try{
  runtime.execute({type:'reset',scenario:standScenario(),diameter:8,standSettings:{heightM:2,loadKg:0,friction:.65,hub:'crown'}});
  expect(runtime.build!.complete).toBe(true);expect(runtime.build!.record().experimentParameters!.hub).toBe('crown');
  runtime.execute({type:'push-stand',direction:'x',impulseNs:100000});runtime.sim!.run(.2);
  expect(runtime.build!.failures.length).toBeGreaterThan(0);
  runtime.execute({type:'reset',scenario:standScenario(),diameter:8,standSettings:{heightM:6,loadKg:0,friction:.65,hub:'plate'}});
  expect(runtime.sim!.ticks).toBe(0);expect(runtime.build!.failures).toEqual([]);
  expect(runtime.sim!.parts.get('test-stand')!.spec.telescopic!.heightM).toBeCloseTo(6,5);
 }finally{runtime.dispose();}
});

test.each(Object.keys(STAND_HUBS) as (keyof typeof STAND_HUBS)[])('ballasted stand remains upright with %s at low, middle and full extension',hub=>{
 for(const heightM of [1.3,4,8.4]){
  const sim=new Simulation(standScenario()),build=new ShedBuild(sim,standDefinition({heightM,loadKg:hub==='plate'?100:0,friction:.65,hub}));
  try{while(!build.complete)build.placeNext();sim.run(3);
   const q=sim.body('test-stand').rotation(),tilt=Math.acos(Math.min(1,1-2*(q.x*q.x+q.z*q.z)))*180/Math.PI;
   expect(tilt).toBeLessThan(.05);expect(build.failures).toEqual([]);
   expect(sim.contacts().some(c=>c.a==='stand-platform'&&c.b==='test-stand'&&c.force>0)).toBe(true);
  }finally{sim.dispose();}
 }
});
