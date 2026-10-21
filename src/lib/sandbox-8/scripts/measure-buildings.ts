// Retains the detailed-stand baseline used by the saved historical measurements.
import {writeFileSync} from 'node:fs';
import {initialize,Simulation,G} from '../simulation';
import {ShedBuild} from '../shed';
import {metalShedDefinition,metalShedScenario} from '../metal-shed';
import {domeDefinition,domeScenario} from '../dome';
import {Wind} from '../wind';
await initialize();const results=[];
for(const [definition,scenario] of [[metalShedDefinition(),metalShedScenario()],[domeDefinition(8,{detailedShoring:true}),domeScenario()]] as const){
 const sim=new Simulation(scenario),build=new ShedBuild(sim,definition),stages=[];
 try{
  for(let stage=0;stage<definition.stages.length;stage++){
   while(build.next?.stage===stage){if(!build.placeNext())throw Error(`Construction stopped: ${JSON.stringify(build.failures[0])}`);sim.run(definition.interval);}
   sim.run(definition.withdrawShoringAfterStage===stage?3:.3);if(build.failures.length)throw Error(`Unexpected gravity damage at ${definition.stages[stage]}`);
   stages.push({stage:definition.stages[stage],parts:build.count,connections:build.connections.size,massKg:sim.mass,maxAnchorErrorM:build.maxAnchorError()});
  }
  sim.run(3);if(build.failures.length)throw Error('Damage after shoring withdrawal');
  let reaction=0;for(let i=0;i<24;i++){sim.step();reaction+=sim.contacts().filter(c=>c.a==='ground').reduce((s,c)=>s+c.force*Math.abs(c.normal.y),0)/24;}
  if(Math.abs(reaction/(sim.mass*G)-1)>.03)throw Error('Ground reaction mismatch');
  const wind=new Wind(sim);wind.configure({enabled:true,speed:10,from:'front'});sim.run(.3);if(build.failures.length)throw Error('Low-wind damage');
  const intact={massKg:sim.mass,parts:build.count,connections:build.connections.size,weightN:sim.mass*G,meanGroundReactionN:reaction,maxAnchorErrorM:build.maxAnchorError(),withdrawals:build.events.filter(e=>e.action==='withdraw-shoring'),bodies:sim.state()};
  wind.configure({enabled:true,speed:100,from:'front'});sim.run(.3);if(!build.failedConnections.size)throw Error('Expected finite failure');
  const result={name:definition.name,timestep:sim.dt,solverIterations:sim.world.numSolverIterations,internalPgsIterations:sim.world.integrationParameters.numInternalPgsIterations,stages,intact,windTrial:{speedMps:100,durationS:.3,failedPoints:build.failures.length,separatedGroups:build.failedConnections.size,firstFailure:build.failures[0],massKg:sim.mass}};
  results.push(result);console.log(result.name,result.intact.parts,result.intact.massKg,result.windTrial);
 }finally{sim.dispose();}
}
writeFileSync('new-building-measurements.json',JSON.stringify({runtime:process.version,results},null,2)+'\n');
