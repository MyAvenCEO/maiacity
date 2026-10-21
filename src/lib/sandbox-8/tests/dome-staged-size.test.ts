import {beforeAll,expect,test} from 'vitest';
import {initialize,Simulation} from '../src/simulation';
import {domeDefinition as detailedDomeDefinition,domeScenario} from '../src/dome';
import {ShedBuild} from '../src/shed';
beforeAll(initialize);
test.each([10,16])('adaptive %s m dome carries gravity throughout staged construction',diameter=>{
 const def=domeDefinition(diameter),sim=new Simulation(domeScenario(diameter)),build=new ShedBuild(sim,def);
 try{
  let stage=-1;
  while(!build.complete){
   if(stage!==build.next.stage&&stage>=0){
    sim.run(stage===4?1:.3);
    console.log(diameter,def.stages[stage],build.count,'failures',build.failures.length);
    expect(build.failures.slice(0,4).map(f=>`${f.a}/${f.b}: ${f.reading.utilization}`)).toEqual([]);
   }
   stage=build.next.stage;expect(build.placeNext()).toBe(true);
   // Advance after every placement, including each supplied prefabricated stand.
   sim.step();expect(build.failures.slice(0,4).map(f=>`${f.a}/${f.b}: ${f.reading.utilization}`)).toEqual([]);
  }
  sim.run(1);expect(build.failures.slice(0,4)).toEqual([]);
  expect(build.maxAnchorError()).toBeLessThan(.005);
 }finally{sim.dispose();}
},300000);

// Retain the original seven-body stands as the detailed reference model.
function domeDefinition(diameter=8){return detailedDomeDefinition(diameter,{detailedShoring:true});}
