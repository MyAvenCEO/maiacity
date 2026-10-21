import {beforeAll,expect,test} from 'vitest';
import {initialize,Simulation,scenarios} from '../src/simulation';
import {ShedBuild,shedScenario} from '../src/shed';
import {WorkerRuntime} from '../src/worker-runtime';
import {SimulationView} from '../src/worker-client';
beforeAll(initialize);
test('worker commands preserve exact assembly, wind-free steps, pause and exported state',()=>{
 const runtime=new WorkerRuntime(),sim=new Simulation(shedScenario()),build=new ShedBuild(sim);
 try{
  runtime.execute({type:'reset',scenario:shedScenario(),diameter:8});
  for(let i=0;i<20;i++){runtime.execute({type:'place'});build.placeNext();runtime.execute({type:'step'});sim.step();}
  expect(runtime.sim!.state()).toEqual(sim.state());expect(runtime.build!.record()).toEqual(build.record());
  const tick=runtime.sim!.ticks;runtime.execute({type:'advance',elapsed:10});expect(runtime.sim!.ticks).toBe(tick);
  const record=runtime.execute({type:'export'}).record as {ticks:number;bodies:unknown};expect(record.bodies).toEqual(sim.state());expect(record.ticks).toBe(tick);
  runtime.execute({type:'run',running:true});runtime.execute({type:'advance',elapsed:1});expect(runtime.sim!.ticks).toBeGreaterThan(tick);expect(runtime.sim!.ticks).toBeLessThanOrEqual(tick+8);
 }finally{runtime.dispose();sim.dispose();}
});
test('snapshot buffers are cloneable and a render view reads authoritative poses',()=>{
 const runtime=new WorkerRuntime();try{
  const first=runtime.execute({type:'reset',scenario:scenarios()[0],diameter:8}).snapshot!,view=new SimulationView();
  view.apply(structuredClone(first));runtime.execute({type:'step'});
  const next=runtime.execute({type:'step'}).snapshot!;view.apply(structuredClone(next));
  for(const [id,p]of view.parts){expect(p.body.translation()).toEqual({...runtime.sim!.body(id).translation()});expect(p.body.mass()).toBe(runtime.sim!.body(id).mass());}
  expect(view.time).toBe(runtime.sim!.time);expect(next.specs).toBeUndefined();
 }finally{runtime.dispose();}
});
test('invalid setup validation preserves the previous world and reset clears state',()=>{
 const runtime=new WorkerRuntime();try{
  const scenario=scenarios()[0];runtime.execute({type:'reset',scenario,diameter:8});runtime.execute({type:'step'});const sim=runtime.sim;
  const invalid=structuredClone(scenario);invalid.boxes.push({...invalid.boxes[1],id:'overlap'});
  expect(()=>runtime.execute({type:'reset',scenario:invalid,diameter:8,validate:true})).toThrow('overlap');expect(runtime.sim).toBe(sim);
  runtime.execute({type:'reset',scenario,diameter:8});expect(runtime.sim!.ticks).toBe(0);expect(runtime.playback!.running).toBe(false);
 }finally{runtime.dispose();}
});
