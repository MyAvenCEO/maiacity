import {initialize,Simulation} from '../src/simulation';import {ShedBuild} from '../src/shed';import {standScenario,standDefinition,STAND_HUBS} from '../src/stand-lab';
await initialize();
for(const hub of Object.keys(STAND_HUBS) as (keyof typeof STAND_HUBS)[])for(const heightM of [1.3,4,8.4]){
 const sim=new Simulation(standScenario()),build=new ShedBuild(sim,standDefinition({heightM,loadKg:hub==='plate'?100:0,friction:.65,hub}));
 try{while(!build.complete)build.placeNext();sim.run(3);const q=sim.body('test-stand').rotation();console.log(JSON.stringify({hub,heightM,loadKg:hub==='plate'?100:0,standMassKg:sim.body('test-stand').mass(),tiltDegrees:Math.acos(Math.min(1,1-2*(q.x*q.x+q.z*q.z)))*180/Math.PI,failures:build.failures.length}));}finally{sim.dispose();}
}
