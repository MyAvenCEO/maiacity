import {initialize,Simulation} from '../src/simulation';
import {domeScenario,domeDefinition} from '../src/dome';
import {ShedBuild} from '../src/shed';
await initialize();
for(const diameter of [8,16]){
 const def=domeDefinition(diameter),sim=new Simulation(domeScenario(diameter)),build=new ShedBuild(sim,def);let peak=0,previous=0,stage=-1;
 try{
  while(!build.complete&&!build.altered){
   if(stage!==build.next.stage){if(stage>=0)sim.run(.3);stage=build.next.stage;console.log(JSON.stringify({diameter,stage,count:build.count,withdrawn:build.withdrawnParts.size}));}
   build.placeNext();sim.step();
   if(build.withdrawnParts.size!==previous){sim.run(.15);previous=build.withdrawnParts.size;}
   peak=Math.max(peak,[...sim.parts.keys()].filter(id=>id.startsWith('assembly-prop')).length);
  }
  sim.run(1);
  console.log(JSON.stringify({diameter,complete:build.complete,count:build.count,peak,withdrawn:build.withdrawnParts.size,error:build.maxAnchorError(),failures:build.failures.slice(0,5)}));
 }finally{sim.dispose();}
}
