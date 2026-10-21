import {beforeAll,expect,test} from 'vitest';
import {initialize,Simulation} from '../src/simulation';
import {domeDefinition,domeScenario} from '../src/dome';
import {ShedBuild} from '../src/shed';
import {Wind} from '../src/wind';
beforeAll(initialize);
test.each([8,16])('%s m dome retains finite wind failure after all scaffolding leaves',diameter=>{
 const sim=new Simulation(domeScenario(diameter)),build=new ShedBuild(sim,domeDefinition(diameter)),wind=new Wind(sim);
 try{
  while(!build.complete)build.placeNext();sim.run(.5);expect(build.failures).toHaveLength(0);
  const mass=sim.mass;wind.configure({enabled:true,speed:10,from:'front'});sim.run(.1);expect(build.failures).toHaveLength(0);
  wind.configure({enabled:true,speed:100,from:'front'});sim.run(.3);expect(build.failures.length).toBeGreaterThan(0);
  expect(sim.mass).toBe(mass);expect([...sim.parts.keys()].some(id=>id.startsWith('assembly-prop'))).toBe(false);
  expect(sim.state().every(p=>Object.values(p.position).every(Number.isFinite))).toBe(true);
 }finally{sim.dispose();}
},180000);
