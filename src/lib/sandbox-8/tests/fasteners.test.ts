// @ts-nocheck — run by bun test, not type-checked, as the app's other tests
import {beforeAll,afterEach,expect,test} from 'vitest';
import {initialize,Simulation,DT,type Box} from '../simulation';
import {FastenerGroup,WOOD_FASTENER} from '../fasteners';
beforeAll(initialize);const worlds:Simulation[]=[];afterEach(()=>worlds.splice(0).forEach(s=>s.dispose()));
const box=(id:string,x:number,fixed=false):Box=>({id,size:[.1,.2,.2],position:{x,y:1,z:0},fixed,density:600,material:'Wood (rigid)',friction:.6,color:0xaabbcc});
function lab(dt=DT,fixed=true){const sim=new Simulation({id:'grip',title:'Grip proof',question:'',boxes:[box('support',0,fixed),box('wood',.1)]},dt);worlds.push(sim);sim.world.gravity={x:0,y:0,z:0};sim.world.numSolverIterations=8;sim.world.integrationParameters.numInternalPgsIterations=12;return {sim,group:new FastenerGroup(sim,'wood','support',WOOD_FASTENER)};}
test.each([DT,DT/2])('grip balances a small withdrawal load and fails above its capacity at dt=%s',dt=>{
 const {sim,group}=lab(dt),body=sim.body('wood');body.addForce({x:1000,y:0,z:0},true);sim.run(1);group.measure();
 expect(group.intact).toBe(4);expect(group.failOverloaded()).toEqual([]);
 expect(group.points.reduce((n,p)=>n+p.reading.withdrawalN,0)).toBeCloseTo(1000,-1);
 body.resetForces(true);body.addForce({x:12000,y:0,z:0},true);
 for(let i=0;i<Math.round(.2/dt);i++){sim.step();group.failOverloaded();}
 expect(group.intact).toBe(0);const x=body.translation().x;sim.run(.1);expect(body.translation().x).toBeGreaterThan(x+.05);
});
test('sideways force fails the wood in shear, not withdrawal',()=>{const{sim,group}=lab();sim.body('wood').lockRotations(true,true);sim.body('wood').addForce({x:0,y:20000,z:0},true);for(let i=0;i<30;i++){sim.step();group.failOverloaded();}expect(group.intact).toBe(0);expect(group.points.every(p=>p.reading.mode==='shear')).toBe(true);});
test('moment overloads the outer fasteners even without a net applied force',()=>{const{sim,group}=lab();sim.body('wood').addTorque({x:0,y:0,z:1000},true);for(let i=0;i<30;i++){sim.step();group.failOverloaded();}expect(group.intact).toBeLessThan(4);});

test('uniform free fall does not damage a connection; broken grips never heal or remove mass',()=>{
 const {sim,group}=lab(DT,false);sim.world.gravity={x:0,y:-9.81,z:0};
 for(let i=0;i<120;i++){sim.step();group.failOverloaded();}expect(group.intact).toBe(4);
 const mass=sim.mass;sim.body('wood').addForce({x:40000,y:0,z:0},true);
 for(let i=0;i<30;i++){sim.step();group.failOverloaded();}expect(group.intact).toBe(0);
 sim.run(.5);expect(group.failOverloaded()).toEqual([]);expect(group.intact).toBe(0);expect(sim.mass).toBe(mass);
});
